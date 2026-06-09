/**
 * Config.gs
 * システム全体の設定を管理するモジュール。
 * APIトークン等の機密情報は Script Properties から取得し、ソースコードにハードコードしない。
 */

// ==================== スプレッドシート設定 ====================
const CONFIG = {
  // 対象スプレッドシートID（Script Properties で管理）
  get SPREADSHEET_ID() {
    return PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID') || '（未設定）';
  },

  // シート名
  SHEET: {
    POSTS:    '投稿マスタ',
    SETTINGS: '設定',
    LOGS:     'ログ',
  },

  // ==================== アカウント設定 ====================
  // 有効にするアカウントは「設定」シートからも制御可能
  ACCOUNTS: [
    {
      id:       'ig_account_1',
      platform: 'instagram',
      label:    'Instagram アカウント1',
      get accessToken() {
        return PropertiesService.getScriptProperties().getProperty('IG_ACCESS_TOKEN_1');
      },
      get igUserId() {
        return PropertiesService.getScriptProperties().getProperty('IG_USER_ID_1');
      },
      enabled: true,
    },
    {
      id:       'ig_account_2',
      platform: 'instagram',
      label:    'Instagram アカウント2',
      get accessToken() {
        return PropertiesService.getScriptProperties().getProperty('IG_ACCESS_TOKEN_2');
      },
      get igUserId() {
        return PropertiesService.getScriptProperties().getProperty('IG_USER_ID_2');
      },
      enabled: true,
    },
    {
      id:       'th_account_1',
      platform: 'threads',
      label:    'Threads アカウント1',
      get accessToken() {
        return PropertiesService.getScriptProperties().getProperty('TH_ACCESS_TOKEN_1');
      },
      get thUserId() {
        return PropertiesService.getScriptProperties().getProperty('TH_USER_ID_1');
      },
      enabled: true,
    },
    {
      id:       'th_account_2',
      platform: 'threads',
      label:    'Threads アカウント2',
      get accessToken() {
        return PropertiesService.getScriptProperties().getProperty('TH_ACCESS_TOKEN_2');
      },
      get thUserId() {
        return PropertiesService.getScriptProperties().getProperty('TH_USER_ID_2');
      },
      enabled: true,
    },
  ],

  // ==================== 投稿間隔設定（シートで上書き可能）====================
  INTERVAL: {
    BASE_MINUTES:   30,   // 基準間隔（分）
    RANDOM_MINUTES: 10,   // ランダム幅（±分）。例: 30±10 → 20〜40分のランダム間隔
    ACTIVE_HOURS: {
      START: 8,   // 稼働開始時刻（時）
      END:   23,  // 稼働終了時刻（時）
    },
  },

  // ==================== リトライ設定 ====================
  RETRY: {
    MAX_ATTEMPTS: 3,       // 最大リトライ回数
    WAIT_SECONDS: 5,       // リトライ間隔（秒）
  },

  // ==================== API エンドポイント ====================
  API: {
    INSTAGRAM_GRAPH: 'https://graph.facebook.com/v19.0',
    THREADS:         'https://graph.threads.net/v1.0',
  },

  // ==================== ロック設定 ====================
  // 二重投稿防止のためのスクリプトロック待機時間（ミリ秒）
  LOCK_WAIT_MS: 30000,
};

/**
 * Script Properties に必要なキーがすべて設定されているか検証する。
 * セットアップ時に手動実行してください。
 */
function validateScriptProperties() {
  const required = [
    'SPREADSHEET_ID',
    'IG_ACCESS_TOKEN_1', 'IG_USER_ID_1',
    'IG_ACCESS_TOKEN_2', 'IG_USER_ID_2',
    'TH_ACCESS_TOKEN_1', 'TH_USER_ID_1',
    'TH_ACCESS_TOKEN_2', 'TH_USER_ID_2',
  ];
  const props = PropertiesService.getScriptProperties().getProperties();
  const missing = required.filter(k => !props[k]);

  if (missing.length > 0) {
    const msg = '【設定漏れ】以下の Script Properties が未設定です:\n' + missing.join('\n');
    Logger.log(msg);
    SpreadsheetApp.getActive() && SpreadsheetApp.getUi().alert(msg);
    throw new Error(msg);
  }
  Logger.log('Script Properties の検証OK: すべてのキーが設定されています。');
}
