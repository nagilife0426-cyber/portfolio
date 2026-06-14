/**
 * ============================================================
 * 出張報告書 自動生成システム
 * Google Apps Script (GAS) — onFormSubmit トリガー版
 * ============================================================
 *
 * 【動作フロー】
 *   1. Googleフォームで出張情報を送信
 *   2. onFormSubmit が自動で起動
 *   3. 「報告書」シートに整形済みの行を追記
 *   4. 「月次集計」シートの合計額を自動更新
 *
 * 【導入手順】
 *   1. Googleフォームを作成し、このスクリプトをコンテナとしてバインド
 *      （フォーム編集画面 → 点3つメニュー → スクリプトエディタ）
 *   2. SHEET_NAME / SUMMARY_SHEET_NAME を実際のシート名に合わせる
 *   3. スクリプトエディタから「トリガーを設定」→
 *      関数: onFormSubmit / イベント: フォーム送信時
 *   4. 権限承認ダイアログに従い許可する
 *
 * ============================================================
 */

// ─── 設定 ────────────────────────────────────────────────────
/** 報告書を書き込むシート名 */
const SHEET_NAME = '出張報告書';

/** 月次集計を書き込むシート名 */
const SUMMARY_SHEET_NAME = '月次集計';

/**
 * フォームの質問タイトルと列番号のマッピング。
 * フォーム側で質問名を変更した場合はここを修正してください。
 */
const FIELD = {
  employeeName : '氏名',
  department   : '部署',
  tripDate     : '出張日',
  returnDate   : '帰着日',
  destination  : '目的地（会社名・場所）',
  purpose      : '出張目的',
  transport    : '交通費（円）',
  accommodation: '宿泊費（円）',
  daily        : '日当（円）',
  other        : 'その他経費（円）',
  notes        : '備考・特記事項',
};

// 報告書シートのヘッダー行（初回自動作成に使用）
const REPORT_HEADERS = [
  '受付番号',
  '提出日時',
  '氏名',
  '部署',
  '出張日',
  '帰着日',
  '目的地',
  '出張目的',
  '交通費（円）',
  '宿泊費（円）',
  '日当（円）',
  'その他（円）',
  '経費合計（円）',
  '備考',
  'ステータス',
];
// ─────────────────────────────────────────────────────────────

/**
 * フォーム送信時に自動実行されるメイン関数。
 * トリガーは「フォーム送信時」に設定してください。
 *
 * @param {GoogleAppsScript.Events.FormsOnFormSubmit} e - フォーム送信イベント
 */
function onFormSubmit(e) {
  try {
    // フォーム回答を取得してオブジェクトに変換
    const answers = parseResponse(e.response);

    // 金額フィールドを数値に変換（空欄は 0）
    const transport      = toNumber(answers[FIELD.transport]);
    const accommodation  = toNumber(answers[FIELD.accommodation]);
    const daily          = toNumber(answers[FIELD.daily]);
    const other          = toNumber(answers[FIELD.other]);
    const totalExpense   = transport + accommodation + daily + other;

    // 受付番号を自動採番（報告書シートの現在行数 + 1）
    const reportSheet = getOrCreateSheet(SHEET_NAME, REPORT_HEADERS);
    const reportNo    = generateReportNo(reportSheet);

    // 報告書シートに1行追記
    appendReportRow(reportSheet, {
      reportNo,
      submittedAt  : new Date(),
      employeeName : answers[FIELD.employeeName]  || '',
      department   : answers[FIELD.department]    || '',
      tripDate     : answers[FIELD.tripDate]       || '',
      returnDate   : answers[FIELD.returnDate]     || '',
      destination  : answers[FIELD.destination]   || '',
      purpose      : answers[FIELD.purpose]       || '',
      transport,
      accommodation,
      daily,
      other,
      totalExpense,
      notes        : answers[FIELD.notes]         || '',
      status       : '提出済み',
    });

    // 月次集計シートを更新
    updateMonthlySummary(transport, accommodation, daily, other, totalExpense);

    Logger.log(`[完了] 受付番号: ${reportNo} / 提出者: ${answers[FIELD.employeeName]}`);

  } catch (err) {
    // エラーをスプレッドシートオーナーにメール通知（GASの組み込み機能）
    const msg = `出張報告書の自動生成でエラーが発生しました。\n\nエラー: ${err.message}\nスタック: ${err.stack}`;
    Logger.log('[ERROR] ' + msg);
    GmailApp.sendEmail(
      Session.getActiveUser().getEmail(),
      '[要確認] 出張報告書 自動生成エラー',
      msg
    );
  }
}

// ─── ヘルパー関数 ────────────────────────────────────────────

/**
 * フォーム回答を { 質問タイトル: 回答テキスト } のオブジェクトに変換する。
 *
 * @param {GoogleAppsScript.Forms.FormResponse} response
 * @returns {Object.<string, string>}
 */
function parseResponse(response) {
  const result = {};
  response.getItemResponses().forEach(itemResp => {
    const title  = itemResp.getItem().getTitle();
    const answer = itemResp.getResponse();
    // 複数回答（チェックボックス等）は配列なのでカンマ結合
    result[title] = Array.isArray(answer) ? answer.join(', ') : String(answer ?? '');
  });
  return result;
}

/**
 * 文字列を数値に変換する。
 * カンマや円記号が混入していても除去して変換する。
 *
 * @param {string|undefined} value
 * @returns {number}
 */
function toNumber(value) {
  if (value === undefined || value === null || value === '') return 0;
  const cleaned = String(value).replace(/[,，¥￥円\s]/g, '');
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

/**
 * 指定名のシートを取得する。存在しない場合はヘッダー付きで新規作成する。
 *
 * @param {string} name - シート名
 * @param {string[]} [headers] - 新規作成時に書き込むヘッダー行
 * @returns {GoogleAppsScript.Spreadsheet.Sheet}
 */
function getOrCreateSheet(name, headers) {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  let sheet   = ss.getSheetByName(name);

  if (!sheet) {
    sheet = ss.insertSheet(name);
    if (headers && headers.length > 0) {
      const headerRange = sheet.getRange(1, 1, 1, headers.length);
      headerRange.setValues([headers]);

      // ヘッダー行をスタイリング
      headerRange
        .setBackground('#1a73e8')   // Google ブルー
        .setFontColor('#ffffff')
        .setFontWeight('bold');
      sheet.setFrozenRows(1);
    }
  }

  return sheet;
}

/**
 * 報告書シートに新しい行を追記する。
 *
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @param {Object} data - appendReportRow に渡すフィールド群
 */
function appendReportRow(sheet, data) {
  const row = [
    data.reportNo,
    data.submittedAt,
    data.employeeName,
    data.department,
    data.tripDate,
    data.returnDate,
    data.destination,
    data.purpose,
    data.transport,
    data.accommodation,
    data.daily,
    data.other,
    data.totalExpense,
    data.notes,
    data.status,
  ];

  const newRow = sheet.getLastRow() + 1;
  sheet.getRange(newRow, 1, 1, row.length).setValues([row]);

  // 日付列のフォーマット
  sheet.getRange(newRow, 2).setNumberFormat('yyyy/MM/dd HH:mm');

  // 金額列（9〜13列目）を通貨フォーマットに
  sheet.getRange(newRow, 9, 1, 5).setNumberFormat('¥#,##0');

  // 合計列を太字に
  sheet.getRange(newRow, 13).setFontWeight('bold');
}

/**
 * 受付番号を採番する。
 * 形式: YYYYMMDD-NNN（例: 20260614-001）
 *
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @returns {string}
 */
function generateReportNo(sheet) {
  const today  = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd');
  const lastRow = sheet.getLastRow();

  if (lastRow <= 1) {
    // ヘッダー行のみ or 空シート → 001 から開始
    return `${today}-001`;
  }

  // 同日の最大連番を探して +1
  const existingNos = sheet.getRange(2, 1, lastRow - 1, 1).getValues().flat();
  const todayNos = existingNos
    .map(v => String(v))
    .filter(v => v.startsWith(today))
    .map(v => parseInt(v.split('-')[1], 10))
    .filter(n => !isNaN(n));

  const nextSeq = todayNos.length > 0 ? Math.max(...todayNos) + 1 : 1;
  return `${today}-${String(nextSeq).padStart(3, '0')}`;
}

/**
 * 月次集計シートの当月行を更新する。
 * 行が存在しない場合は新規追加する。
 *
 * @param {number} transport
 * @param {number} accommodation
 * @param {number} daily
 * @param {number} other
 * @param {number} total
 */
function updateMonthlySummary(transport, accommodation, daily, other, total) {
  const summaryHeaders = ['年月', '提出件数', '交通費合計', '宿泊費合計', '日当合計', 'その他合計', '経費総合計'];
  const sheet = getOrCreateSheet(SUMMARY_SHEET_NAME, summaryHeaders);

  const yearMonth = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy/MM');
  const lastRow   = sheet.getLastRow();

  // 当月行を検索
  let targetRow = -1;
  if (lastRow >= 2) {
    const yearMonths = sheet.getRange(2, 1, lastRow - 1, 1).getValues().flat();
    yearMonths.forEach((ym, idx) => {
      if (String(ym) === yearMonth) targetRow = idx + 2; // +2 はヘッダー分
    });
  }

  if (targetRow === -1) {
    // 当月行がなければ新規追加
    targetRow = sheet.getLastRow() + 1;
    sheet.getRange(targetRow, 1).setValue(yearMonth);
    sheet.getRange(targetRow, 2).setValue(0); // 件数を初期化
  }

  // 値を加算更新
  const row = sheet.getRange(targetRow, 1, 1, 7).getValues()[0];
  sheet.getRange(targetRow, 1, 1, 7).setValues([[
    yearMonth,
    (Number(row[1]) || 0) + 1,          // 件数
    (Number(row[2]) || 0) + transport,
    (Number(row[3]) || 0) + accommodation,
    (Number(row[4]) || 0) + daily,
    (Number(row[5]) || 0) + other,
    (Number(row[6]) || 0) + total,
  ]]);

  // 金額列を通貨フォーマットに
  sheet.getRange(targetRow, 3, 1, 5).setNumberFormat('¥#,##0');
}

// ─────────────────────────────────────────────────────────────
// ▼ 開発・テスト用ユーティリティ（本番では呼び出し不要）
// ─────────────────────────────────────────────────────────────

/**
 * スクリプトエディタから手動実行してシートのヘッダーを初期化できる。
 * 既存シートがある場合は何もしない（上書きしない）。
 */
function initSheets() {
  getOrCreateSheet(SHEET_NAME, REPORT_HEADERS);
  getOrCreateSheet(SUMMARY_SHEET_NAME, ['年月', '提出件数', '交通費合計', '宿泊費合計', '日当合計', 'その他合計', '経費総合計']);
  Logger.log('シートを初期化しました。');
}

/**
 * ダミーデータで動作確認するためのテスト関数。
 * スクリプトエディタから手動実行して挙動を確認する。
 */
function testOnFormSubmit() {
  // フォーム送信イベントを模倣したモックオブジェクト
  const mockE = {
    response: {
      getItemResponses: () => [
        { getItem: () => ({ getTitle: () => '氏名' }),                      getResponse: () => 'テスト 太郎' },
        { getItem: () => ({ getTitle: () => '部署' }),                      getResponse: () => '営業部' },
        { getItem: () => ({ getTitle: () => '出張日' }),                    getResponse: () => '2026/06/15' },
        { getItem: () => ({ getTitle: () => '帰着日' }),                    getResponse: () => '2026/06/16' },
        { getItem: () => ({ getTitle: () => '目的地（会社名・場所）' }),    getResponse: () => '株式会社サンプル（大阪）' },
        { getItem: () => ({ getTitle: () => '出張目的' }),                  getResponse: () => '新規顧客との商談・契約締結' },
        { getItem: () => ({ getTitle: () => '交通費（円）' }),              getResponse: () => '12500' },
        { getItem: () => ({ getTitle: () => '宿泊費（円）' }),              getResponse: () => '8000' },
        { getItem: () => ({ getTitle: () => '日当（円）' }),                getResponse: () => '2000' },
        { getItem: () => ({ getTitle: () => 'その他経費（円）' }),          getResponse: () => '500' },
        { getItem: () => ({ getTitle: () => '備考・特記事項' }),            getResponse: () => 'タクシー領収書あり' },
      ],
    },
  };

  onFormSubmit(mockE);
  Logger.log('テスト実行完了。スプレッドシートを確認してください。');
}
