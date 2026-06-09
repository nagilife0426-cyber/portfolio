/**
 * SheetRepo.gs
 * スプレッドシートの読み書きを担当するリポジトリモジュール。
 * 直接 SpreadsheetApp を触るのはこのファイルのみに集約する。
 */

// ==================== 投稿マスタ 列インデックス（0始まり）====================
const POST_COL = {
  ID:            0,  // 投稿ID
  IMAGE_URL:     1,  // 画像URL
  CAPTION:       2,  // 本文（キャプション）
  STATUS:        3,  // 状態（pending / done）
  LAST_POSTED:   4,  // 最終投稿日時
  POST_COUNT:    5,  // 投稿回数
};

// ==================== 設定シート 行インデックス（0始まり）====================
const SETTING_ROW = {
  BASE_MINUTES:   1,
  RANDOM_MINUTES: 2,
  ACTIVE_START:   3,
  ACTIVE_END:     4,
};
const SETTING_VALUE_COL = 1; // B列に値

// ==================== ログシート 列インデックス（0始まり）====================
const LOG_COL = {
  TIMESTAMP:  0,
  ACCOUNT_ID: 1,
  POST_ID:    2,
  PLATFORM:   3,
  RESULT:     4,  // success / error
  ERROR_MSG:  5,
  MEDIA_ID:   6,
};

// =========================================================================

/**
 * スプレッドシートオブジェクトを返す（キャッシュ付き）。
 * @returns {GoogleAppsScript.Spreadsheet.Spreadsheet}
 */
function getSpreadsheet_() {
  // スクリプト実行中はキャッシュを再利用
  if (!SheetRepo._ss) {
    SheetRepo._ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  }
  return SheetRepo._ss;
}

const SheetRepo = {
  _ss: null,

  // ---- 投稿マスタ --------------------------------------------------------

  /**
   * 投稿マスタのすべての行を取得する。
   * @returns {Array<Object>} 投稿オブジェクトの配列
   */
  getAllPosts() {
    const sheet = getSpreadsheet_().getSheetByName(CONFIG.SHEET.POSTS);
    const data  = sheet.getDataRange().getValues();
    return data.slice(1).map((row, i) => ({
      rowIndex:    i + 1,              // ヘッダーを除いた実行インデックス（シート上の行番号 = rowIndex+1）
      sheetRow:    i + 2,              // スプレッドシート上の行番号（1ヘッダー + i + 1）
      id:          row[POST_COL.ID],
      imageUrl:    row[POST_COL.IMAGE_URL],
      caption:     row[POST_COL.CAPTION],
      status:      row[POST_COL.STATUS]    || 'pending',
      lastPosted:  row[POST_COL.LAST_POSTED],
      postCount:   row[POST_COL.POST_COUNT] || 0,
    })).filter(p => p.id !== '');
  },

  /**
   * すべての投稿が完了済みか判定する。
   * @returns {boolean}
   */
  allPostsDone() {
    const posts = this.getAllPosts();
    return posts.length > 0 && posts.every(p => p.status === 'done');
  },

  /**
   * 次に投稿すべき行を返す（status=pending の最初の行）。
   * @returns {Object|null}
   */
  getNextPendingPost() {
    const posts = this.getAllPosts();
    return posts.find(p => p.status === 'pending') || null;
  },

  /**
   * 全投稿のステータスを pending にリセットしてループを再開する。
   */
  resetAllPostStatus() {
    const sheet = getSpreadsheet_().getSheetByName(CONFIG.SHEET.POSTS);
    const posts = this.getAllPosts();
    posts.forEach(p => {
      sheet.getRange(p.sheetRow, POST_COL.STATUS + 1).setValue('pending');
    });
    Logger.log(`全 ${posts.length} 件を pending にリセットしました（ループ再開）。`);
  },

  /**
   * 指定した投稿の状態・日時・回数を更新する。
   * @param {Object} post getAllPosts() で取得した投稿オブジェクト
   * @param {string} status 'done' | 'error'
   */
  markPostDone(post, status) {
    const sheet = getSpreadsheet_().getSheetByName(CONFIG.SHEET.POSTS);
    const now   = new Date();
    sheet.getRange(post.sheetRow, POST_COL.STATUS      + 1).setValue(status);
    sheet.getRange(post.sheetRow, POST_COL.LAST_POSTED + 1).setValue(now);
    sheet.getRange(post.sheetRow, POST_COL.POST_COUNT  + 1).setValue(Number(post.postCount) + 1);
  },

  // ---- 設定シート --------------------------------------------------------

  /**
   * 設定シートから間隔設定を取得する。
   * シートに値がなければ Config.gs のデフォルト値を返す。
   * @returns {Object}
   */
  getIntervalSettings() {
    try {
      const sheet  = getSpreadsheet_().getSheetByName(CONFIG.SHEET.SETTINGS);
      const data   = sheet.getDataRange().getValues();
      const getVal = (rowIdx) => {
        const v = data[rowIdx] && data[rowIdx][SETTING_VALUE_COL];
        return (v !== '' && v !== undefined && v !== null) ? Number(v) : null;
      };
      return {
        baseMinutes:   getVal(SETTING_ROW.BASE_MINUTES)   ?? CONFIG.INTERVAL.BASE_MINUTES,
        randomMinutes: getVal(SETTING_ROW.RANDOM_MINUTES) ?? CONFIG.INTERVAL.RANDOM_MINUTES,
        activeStart:   getVal(SETTING_ROW.ACTIVE_START)   ?? CONFIG.INTERVAL.ACTIVE_HOURS.START,
        activeEnd:     getVal(SETTING_ROW.ACTIVE_END)     ?? CONFIG.INTERVAL.ACTIVE_HOURS.END,
      };
    } catch (e) {
      Logger.log('設定シート読み込み失敗。デフォルト値を使用します: ' + e.message);
      return {
        baseMinutes:   CONFIG.INTERVAL.BASE_MINUTES,
        randomMinutes: CONFIG.INTERVAL.RANDOM_MINUTES,
        activeStart:   CONFIG.INTERVAL.ACTIVE_HOURS.START,
        activeEnd:     CONFIG.INTERVAL.ACTIVE_HOURS.END,
      };
    }
  },

  // ---- ログシート --------------------------------------------------------

  /**
   * 実行ログを1行追記する。
   * @param {Object} entry ログエントリ
   */
  appendLog(entry) {
    try {
      const sheet = getSpreadsheet_().getSheetByName(CONFIG.SHEET.LOGS);
      sheet.appendRow([
        new Date(),
        entry.accountId  || '',
        entry.postId     || '',
        entry.platform   || '',
        entry.result     || '',
        entry.errorMsg   || '',
        entry.mediaId    || '',
      ]);
    } catch (e) {
      // ログ書き込み失敗は握りつぶさず console に残す
      Logger.log('ログ書き込みエラー: ' + e.message);
    }
  },

  /**
   * 直近 N 件のログを取得する（ダッシュボード用）。
   * @param {number} n 件数
   * @returns {Array<Object>}
   */
  getRecentLogs(n = 50) {
    const sheet = getSpreadsheet_().getSheetByName(CONFIG.SHEET.LOGS);
    const data  = sheet.getDataRange().getValues();
    return data.slice(1).slice(-n).reverse().map(row => ({
      timestamp:  row[LOG_COL.TIMESTAMP],
      accountId:  row[LOG_COL.ACCOUNT_ID],
      postId:     row[LOG_COL.POST_ID],
      platform:   row[LOG_COL.PLATFORM],
      result:     row[LOG_COL.RESULT],
      errorMsg:   row[LOG_COL.ERROR_MSG],
      mediaId:    row[LOG_COL.MEDIA_ID],
    }));
  },
};
