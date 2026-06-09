/**
 * Poster.gs
 * 投稿の振り分け・リトライ・履歴記録を担当するモジュール。
 * InstagramApi / ThreadsApi を呼び出してすべてのアカウントへ同一内容を配信する。
 */

const Poster = {

  /**
   * 指定した投稿内容をすべての有効アカウントへ配信する。
   * 各アカウントの結果はログシートに記録する。
   *
   * @param {Object} post  SheetRepo.getNextPendingPost() の投稿オブジェクト
   * @returns {boolean}    全アカウントで成功した場合 true
   */
  dispatchToAll(post) {
    const accounts = CONFIG.ACCOUNTS.filter(a => a.enabled);
    let allSuccess = true;

    accounts.forEach(account => {
      const result = this._postWithRetry(account, post);

      // ログ記録
      SheetRepo.appendLog({
        accountId: account.id,
        postId:    post.id,
        platform:  account.platform,
        result:    result.success ? 'success' : 'error',
        errorMsg:  result.error   || '',
        mediaId:   result.mediaId || '',
      });

      if (!result.success) {
        allSuccess = false;
        Logger.log(`[Poster] ${account.label} への投稿失敗: ${result.error}`);
      }
    });

    return allSuccess;
  },

  // ---- プライベートメソッド ------------------------------------------------

  /**
   * 1アカウントへの投稿をリトライ付きで実行する。
   * @private
   * @param {Object} account Config.ACCOUNTS のアカウントオブジェクト
   * @param {Object} post    投稿オブジェクト
   * @returns {Object} { success, mediaId, error }
   */
  _postWithRetry(account, post) {
    let lastResult = null;

    for (let attempt = 1; attempt <= CONFIG.RETRY.MAX_ATTEMPTS; attempt++) {
      Logger.log(`[Poster] ${account.label} 投稿試行 ${attempt}/${CONFIG.RETRY.MAX_ATTEMPTS} (postId=${post.id})`);

      try {
        lastResult = this._callApi(account, post.imageUrl, post.caption);
      } catch (e) {
        lastResult = { success: false, mediaId: null, error: e.message };
      }

      if (lastResult.success) {
        return lastResult;
      }

      if (attempt < CONFIG.RETRY.MAX_ATTEMPTS) {
        Logger.log(`[Poster] ${CONFIG.RETRY.WAIT_SECONDS}秒後にリトライします...`);
        Utilities.sleep(CONFIG.RETRY.WAIT_SECONDS * 1000);
      }
    }

    return lastResult || { success: false, mediaId: null, error: '不明なエラー' };
  },

  /**
   * プラットフォームに応じた API を呼び分ける。
   * @private
   */
  _callApi(account, imageUrl, caption) {
    switch (account.platform) {
      case 'instagram':
        return InstagramApi.post(account, imageUrl, caption);
      case 'threads':
        return ThreadsApi.post(account, imageUrl, caption);
      default:
        return { success: false, mediaId: null, error: `未対応プラットフォーム: ${account.platform}` };
    }
  },
};
