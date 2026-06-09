/**
 * ThreadsApi.gs
 * Threads API を使った画像付き投稿モジュール。
 * Threads も Instagram Graph API と同様に2ステップ（コンテナ作成 → 公開）。
 *
 * 参考: https://developers.facebook.com/docs/threads/posts
 */

const ThreadsApi = {

  /**
   * 画像付き投稿を行う。
   * @param {Object} account   Config.ACCOUNTS のアカウントオブジェクト
   * @param {string} imageUrl  公開アクセス可能な画像URL（JPEG/PNG）
   * @param {string} caption   キャプション（本文）
   * @returns {Object} { success: boolean, mediaId: string|null, error: string|null }
   */
  post(account, imageUrl, caption) {
    try {
      // ステップ1: メディアコンテナ作成
      const containerId = this._createContainer(account, imageUrl, caption);
      if (!containerId) {
        return { success: false, mediaId: null, error: 'コンテナ作成に失敗しました。' };
      }

      // ステップ2: コンテナのステータスを確認（最大 30 秒待機）
      const ready = this._waitForContainerReady(account, containerId);
      if (!ready) {
        return { success: false, mediaId: null, error: 'コンテナが FINISHED 状態にならずタイムアウトしました。' };
      }

      // ステップ3: 公開
      const mediaId = this._publishContainer(account, containerId);
      if (!mediaId) {
        return { success: false, mediaId: null, error: '公開（publish）に失敗しました。' };
      }

      Logger.log(`[Threads][${account.label}] 投稿成功 mediaId=${mediaId}`);
      return { success: true, mediaId: mediaId, error: null };

    } catch (e) {
      const msg = `[Threads][${account.label}] 予期せぬエラー: ${e.message}`;
      Logger.log(msg);
      return { success: false, mediaId: null, error: msg };
    }
  },

  // ---- プライベートメソッド ------------------------------------------------

  /**
   * メディアコンテナを作成し、コンテナIDを返す。
   * @private
   */
  _createContainer(account, imageUrl, caption) {
    const url = `${CONFIG.API.THREADS}/${account.thUserId}/threads`;
    const payload = {
      media_type:   'IMAGE',
      image_url:    imageUrl,
      text:         caption,
      access_token: account.accessToken,
    };

    const res = this._fetch(url, 'post', payload);
    if (!res || !res.id) {
      Logger.log('[Threads] コンテナ作成レスポンス異常: ' + JSON.stringify(res));
      return null;
    }
    Logger.log(`[Threads][${account.label}] コンテナ作成OK: containerId=${res.id}`);
    return res.id;
  },

  /**
   * コンテナのステータスが FINISHED になるまで最大 30 秒待機する。
   * @private
   */
  _waitForContainerReady(account, containerId, maxRetry = 6, intervalSec = 5) {
    const url = `${CONFIG.API.THREADS}/${containerId}?fields=status&access_token=${account.accessToken}`;
    for (let i = 0; i < maxRetry; i++) {
      Utilities.sleep(intervalSec * 1000);
      const res = this._fetch(url, 'get');
      if (res && res.status === 'FINISHED') {
        return true;
      }
      Logger.log(`[Threads] コンテナステータス確認 ${i + 1}/${maxRetry}: ${res && res.status}`);
      if (res && res.status === 'ERROR') {
        Logger.log('[Threads] コンテナがエラー状態です。');
        return false;
      }
    }
    return false;
  },

  /**
   * コンテナを公開してメディアIDを返す。
   * @private
   */
  _publishContainer(account, containerId) {
    const url = `${CONFIG.API.THREADS}/${account.thUserId}/threads_publish`;
    const payload = {
      creation_id:  containerId,
      access_token: account.accessToken,
    };

    const res = this._fetch(url, 'post', payload);
    if (!res || !res.id) {
      Logger.log('[Threads] publish レスポンス異常: ' + JSON.stringify(res));
      return null;
    }
    return res.id;
  },

  /**
   * HTTP リクエストを送信してレスポンスを JSON で返す汎用メソッド。
   * @private
   */
  _fetch(url, method, payload) {
    const options = {
      method:             method,
      muteHttpExceptions: true,
    };
    if (method === 'post' && payload) {
      options.contentType = 'application/x-www-form-urlencoded';
      options.payload     = payload;
    }

    const res  = UrlFetchApp.fetch(url, options);
    const code = res.getResponseCode();
    const body = JSON.parse(res.getContentText());

    if (code >= 400) {
      const errMsg = (body.error && body.error.message) || res.getContentText();
      throw new Error(`HTTP ${code}: ${errMsg}`);
    }
    return body;
  },
};
