/**
 * Menu.gs
 * スプレッドシートにカスタムメニューを追加して
 * Importer / Aggregator / Dashboard の各機能をワンクリックで実行できるようにする
 */

// ==============================
// 起動時フック
// ==============================

/**
 * スプレッドシートを開いたとき自動実行される
 * カスタムメニュー「Amazonツール」を追加する
 */
function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('🛒 Amazon集計ツール')
    .addSubMenu(
      ui.createMenu('📥 1. レポート取込')
        .addItem('売上レポートCSVを取込', 'onImportSalesReportClick')
        .addItem('広告レポートCSVを取込', 'onImportAdReportClick')
        .addItem('在庫レポートCSVを取込', 'onImportInventoryReportClick')
        .addSeparator()
        .addItem('全レポートを一括取込（ファイルID指定）', 'onImportAllReportsClick')
    )
    .addItem('📊 2. 集計を実行', 'onRunAggregationClick')
    .addItem('📈 3. ダッシュボードを更新', 'onBuildDashboardClick')
    .addSeparator()
    .addItem('⚡ 全処理を一括実行（取込→集計→ダッシュボード）', 'onRunAllClick')
    .addSeparator()
    .addSubMenu(
      ui.createMenu('⚙️ 設定')
        .addItem('列マッピング設定シートを表示', 'onShowMappingSheetClick')
        .addItem('バージョン情報', 'onShowVersionClick')
    )
    .addToUi();
}

// ==============================
// メニュー実行ハンドラ
// ==============================

/** 売上レポートCSV取込 */
function onImportSalesReportClick() {
  importSalesReportByPicker();
}

/** 広告レポートCSV取込 */
function onImportAdReportClick() {
  importAdReportByPicker();
}

/** 在庫レポートCSV取込 */
function onImportInventoryReportClick() {
  importInventoryReportByPicker();
}

/**
 * 全レポートを一括取込（ファイルIDを3つまとめて入力するダイアログ）
 */
function onImportAllReportsClick() {
  const ui = SpreadsheetApp.getUi();

  // 売上
  const salesResp = ui.prompt(
    '一括取込 (1/3)',
    '売上レポートCSVのファイルIDまたはURLを入力してください。\n（スキップする場合は空白のままOK）',
    ui.ButtonSet.OK_CANCEL
  );
  if (salesResp.getSelectedButton() === ui.Button.CANCEL) return;
  const salesInput = salesResp.getResponseText().trim();

  // 広告
  const adResp = ui.prompt(
    '一括取込 (2/3)',
    '広告レポートCSVのファイルIDまたはURLを入力してください。\n（スキップする場合は空白のままOK）',
    ui.ButtonSet.OK_CANCEL
  );
  if (adResp.getSelectedButton() === ui.Button.CANCEL) return;
  const adInput = adResp.getResponseText().trim();

  // 在庫
  const invResp = ui.prompt(
    '一括取込 (3/3)',
    '在庫レポートCSVのファイルIDまたはURLを入力してください。\n（スキップする場合は空白のままOK）',
    ui.ButtonSet.OK_CANCEL
  );
  if (invResp.getSelectedButton() === ui.Button.CANCEL) return;
  const invInput = invResp.getResponseText().trim();

  let results = [];

  if (salesInput) {
    const id = extractFileId_(salesInput);
    const sheet = importSalesReport(id);
    results.push(sheet ? '✅ 売上レポート: 取込完了' : '❌ 売上レポート: 取込失敗');
  }
  if (adInput) {
    const id = extractFileId_(adInput);
    const sheet = importAdReport(id);
    results.push(sheet ? '✅ 広告レポート: 取込完了' : '❌ 広告レポート: 取込失敗');
  }
  if (invInput) {
    const id = extractFileId_(invInput);
    const sheet = importInventoryReport(id);
    results.push(sheet ? '✅ 在庫レポート: 取込完了' : '❌ 在庫レポート: 取込失敗');
  }

  if (results.length === 0) {
    ui.alert('ファイルIDが入力されませんでした。処理をキャンセルします。');
    return;
  }

  ui.alert('一括取込 完了', results.join('\n'), ui.ButtonSet.OK);
}

/** 集計実行 */
function onRunAggregationClick() {
  const result = runAggregation();
  if (result) {
    const { totals } = result;
    SpreadsheetApp.getUi().alert(
      '集計が完了しました！\n' +
      `純売上: ¥${Math.round(totals.netRevenue).toLocaleString()}\n` +
      `粗利: ¥${Math.round(totals.grossProfit).toLocaleString()}\n` +
      `粗利率: ${totals.grossProfitRate.toFixed(1)}%\n` +
      `ACoS: ${totals.acos.toFixed(1)}%`
    );
  }
}

/** ダッシュボード更新 */
function onBuildDashboardClick() {
  buildDashboard();
}

/**
 * 全処理を一括実行する
 * 取込済みのRAWシートが前提。なければ取込から促す。
 */
function onRunAllClick() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ui = SpreadsheetApp.getUi();

  const hasSales = !!ss.getSheetByName('RAW_売上');
  const hasAd = !!ss.getSheetByName('RAW_広告');

  if (!hasSales) {
    const resp = ui.alert(
      '確認',
      '売上レポートが取り込まれていません。先にレポートを取り込みますか？',
      ui.ButtonSet.YES_NO
    );
    if (resp === ui.Button.YES) {
      onImportAllReportsClick();
    } else {
      return;
    }
  }

  // 集計
  const result = runAggregation();
  if (!result) return;

  // ダッシュボード生成
  buildDashboard();
}

/** 列マッピング設定シートを表示/作成 */
function onShowMappingSheetClick() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheetName = 'MAPPING_CONFIG';
  let sheet = ss.getSheetByName(sheetName);

  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    buildMappingConfigSheet_(sheet);
  }

  ss.setActiveSheet(sheet);
}

/** バージョン情報 */
function onShowVersionClick() {
  SpreadsheetApp.getUi().alert(
    'バージョン情報',
    'Amazon集計ツール v1.0.0\n\n' +
    '対応レポート:\n' +
    '  ・Amazonセラーセントラル 売上レポート\n' +
    '  ・スポンサープロダクト 広告レポート\n' +
    '  ・FBA 在庫レポート\n\n' +
    '開発: なぎ（Tomoya & Co.）\n' +
    '問い合わせ: クラウドワークスのメッセージよりお願いいたします',
    SpreadsheetApp.getUi().ButtonSet.OK
  );
}

// ==============================
// 列マッピング設定シート生成
// ==============================

/**
 * 列マッピング設定シートを生成する
 * 実際の列名とマッピングされる標準名を一覧表示する
 * @private
 */
function buildMappingConfigSheet_(sheet) {
  sheet.getRange(1, 1).setValue('列マッピング設定（参照用）').setFontWeight('bold').setFontSize(13);
  sheet.getRange(2, 1).setValue('※このシートは参照のみ。変更はImporter.gsのCOLUMN_MAPを編集してください。');
  sheet.getRange(2, 1).setFontColor('#c5221f').setFontSize(10);

  let row = 4;

  const sections = [
    { title: '売上レポート', map: SALES_COLUMN_MAP },
    { title: '広告レポート', map: AD_COLUMN_MAP },
    { title: '在庫レポート', map: INVENTORY_COLUMN_MAP },
  ];

  sections.forEach(section => {
    sheet.getRange(row, 1, 1, 3).setValues([[section.title, '標準列名（内部使用）', '認識するヘッダー名（候補）']])
      .setBackground('#1a73e8').setFontColor('#ffffff').setFontWeight('bold');
    row++;

    // Note: SALES_COLUMN_MAP等はImporter.gsで定義されており、GASでは同プロジェクト内のスコープで参照可能
    let i = 0;
    for (const [key, candidates] of Object.entries(section.map)) {
      const bg = i % 2 === 0 ? '#ffffff' : '#f8f9fa';
      sheet.getRange(row, 1, 1, 3).setValues([[
        '',
        key,
        candidates.join(', ')
      ]]).setBackground(bg);
      row++;
      i++;
    }
    row++;
  });

  sheet.autoResizeColumns(1, 3);
}

// ==============================
// ユーティリティ（プライベート）
// ==============================

/**
 * URLまたは生のIDからファイルIDを抽出する
 * @private
 */
function extractFileId_(input) {
  if (!input) return input;
  const match = input.match(/\/d\/([a-zA-Z0-9_-]+)/);
  return match ? match[1] : input.trim();
}
