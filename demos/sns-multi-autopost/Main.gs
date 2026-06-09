/**
 * Main.gs
 * 時間トリガーのエントリポイント。
 * 以下の処理を順に実行する:
 *   1. 二重投稿防止ロックを取得
 *   2. 次の pending 投稿を取得
 *   3. 全投稿完了していればループリセット
 *   4. 全アカウントへ投稿
 *   5. 次回トリガーをランダム間隔で再設定
 */

// ==================== メインエントリ ====================

/**
 * 時間トリガーから呼び出されるメイン関数。
 * GAS プロジェクトの「トリガー」から triggerPostQueue を登録してください。
 */
function triggerPostQueue() {
  // 二重投稿防止: スクリプトロックを取得
  const lock = LockService.getScriptLock();
  const acquired = lock.tryLock(CONFIG.LOCK_WAIT_MS);
  if (!acquired) {
    Logger.log('[Main] 別の実行が進行中のためスキップします（ロック取得失敗）。');
    return;
  }

  try {
    Logger.log('===== triggerPostQueue 開始 =====');

    // 稼働時間帯チェック
    if (!isWithinActiveHours_()) {
      Logger.log('[Main] 稼働時間外のためスキップ。次回トリガーを再設定します。');
      scheduleNextTrigger_();
      return;
    }

    // 全投稿完了チェック → ループリセット
    if (SheetRepo.allPostsDone()) {
      Logger.log('[Main] 全投稿が完了しました。ループリセットして先頭から再開します。');
      SheetRepo.resetAllPostStatus();
    }

    // 次の投稿を取得
    const post = SheetRepo.getNextPendingPost();
    if (!post) {
      Logger.log('[Main] 投稿対象がありません（マスタが空？）。');
      scheduleNextTrigger_();
      return;
    }

    Logger.log(`[Main] 投稿開始: id=${post.id}, imageUrl=${post.imageUrl}`);

    // 全アカウントへ投稿
    const success = Poster.dispatchToAll(post);

    // 投稿済みフラグを更新（一部失敗でも done にして進める設計。要件次第で変更可）
    SheetRepo.markPostDone(post, success ? 'done' : 'error');

    Logger.log(`[Main] 投稿処理完了 (postId=${post.id}, 全成功=${success})`);

  } catch (e) {
    Logger.log('[Main] 予期せぬエラー: ' + e.message + '\n' + e.stack);
    // エラー通知メール（任意）
    notifyError_('[Main] 予期せぬエラー', e.message);

  } finally {
    lock.releaseLock();
    // 次回トリガーをランダム間隔で再設定
    scheduleNextTrigger_();
    Logger.log('===== triggerPostQueue 終了 =====');
  }
}

// ==================== セットアップ用ユーティリティ ====================

/**
 * 初回セットアップ: 最初のトリガーを登録する。
 * スプレッドシートの「拡張機能 > Apps Script」から手動実行してください。
 */
function setupFirstTrigger() {
  // 既存の triggerPostQueue トリガーを全削除してから再登録
  deleteAllTriggers_();
  ScriptApp.newTrigger('triggerPostQueue')
    .timeBased()
    .after(1) // 1ミリ秒後 = ほぼ即時
    .create();
  Logger.log('[Setup] 初回トリガーを登録しました。');
}

/**
 * すべての triggerPostQueue トリガーを削除する（クリーンアップ用）。
 */
function deleteAllTriggers() {
  deleteAllTriggers_();
  Logger.log('[Setup] すべてのトリガーを削除しました。');
}

/**
 * Script Properties の設定検証を実行する。
 * セットアップ時に確認用として手動実行してください。
 */
function runValidation() {
  validateScriptProperties();
}

// ==================== プライベートヘルパー ====================

/**
 * 現在時刻が稼働時間帯（設定シートの activeStart〜activeEnd）かどうか判定する。
 * @private
 */
function isWithinActiveHours_() {
  const settings = SheetRepo.getIntervalSettings();
  const now      = new Date();
  const hour     = now.getHours();
  return hour >= settings.activeStart && hour < settings.activeEnd;
}

/**
 * ランダム間隔で次回の時間トリガーを再設定する。
 * 既存の triggerPostQueue トリガーを削除してから新規作成する。
 * @private
 */
function scheduleNextTrigger_() {
  const settings     = SheetRepo.getIntervalSettings();
  const baseMs       = settings.baseMinutes   * 60 * 1000;
  const randomRangeMs = settings.randomMinutes * 60 * 1000;

  // ランダム幅: ±randomMinutes 分の範囲で調整
  const jitter     = Math.floor(Math.random() * randomRangeMs * 2) - randomRangeMs;
  const intervalMs = Math.max(baseMs + jitter, 60 * 1000); // 最低1分

  const nextMin = Math.round(intervalMs / 60000);
  Logger.log(`[Main] 次回トリガー: ${nextMin} 分後`);

  deleteAllTriggers_();
  ScriptApp.newTrigger('triggerPostQueue')
    .timeBased()
    .after(intervalMs)
    .create();
}

/**
 * triggerPostQueue に紐づくすべてのトリガーを削除する。
 * @private
 */
function deleteAllTriggers_() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'triggerPostQueue')
    .forEach(t => ScriptApp.deleteTrigger(t));
}

/**
 * エラー発生時にオーナーへメール通知する（任意）。
 * @private
 */
function notifyError_(subject, body) {
  try {
    const email = Session.getEffectiveUser().getEmail();
    MailApp.sendEmail(email, `[SNS自動投稿] ${subject}`, body);
  } catch (e) {
    Logger.log('[Main] エラーメール送信に失敗: ' + e.message);
  }
}
