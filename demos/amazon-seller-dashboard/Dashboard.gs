/**
 * Dashboard.gs
 * SUMMARYシートの集計データをもとにダッシュボードシートを生成するモジュール
 *
 * 生成するシート: DASHBOARD
 *   - KPIカード（純売上・粗利・粗利率・ACoS・総注文数・在庫切れ警告数）
 *   - 月別推移テーブル（売上・粗利・広告費・ACoS）
 *   - 商品別パフォーマンステーブル（上位20品）
 *   - 在庫アラートセクション（在庫切れ20日以内の商品一覧）
 *   - スプレッドシートのグラフ（月別売上・粗利推移）
 */

// ==============================
// スタイル定数
// ==============================

const COLORS = {
  primary: '#1a73e8',
  success: '#137333',
  warning: '#b06000',
  danger: '#c5221f',
  neutral: '#5f6368',
  bgDark: '#202124',
  bgCard: '#f8f9fa',
  bgWhite: '#ffffff',
  headerBg: '#1a73e8',
  headerFg: '#ffffff',
  altRow: '#f1f3f4',
  border: '#dadce0',
  kpiRevenue: '#1a73e8',
  kpiProfit: '#137333',
  kpiAcos: '#e8710a',
  kpiOrder: '#5f6368',
};

// ==============================
// メイン関数
// ==============================

/**
 * ダッシュボードシートを生成・更新する
 * Aggregator.runAggregation() の後に呼ぶ
 */
function buildDashboard() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  try {
    // まずSUMMARYシートから集計済みデータを読む
    const summarySheet = ss.getSheetByName('SUMMARY');
    if (!summarySheet) {
      throw new Error('SUMMARYシートが見つかりません。先に「集計を実行」してください。');
    }

    // 集計データを再取得（Aggregator.runAggregation()の戻り値を再利用できる場合はそちらを使う）
    const result = runAggregation();
    if (!result) throw new Error('集計処理に失敗しました。');

    const { byProduct, byMonth, totals } = result;

    // ダッシュボードシートの作成/初期化
    let sheet = getOrCreateSheet_(ss, 'DASHBOARD');
    sheet.clearContents();
    sheet.clearFormats();
    sheet.setColumnWidth(1, 20);  // 左マージン列

    let row = 1;

    // タイトル
    row = writeTitle_(sheet, row, totals);

    // KPIカード行
    row = writeKpiCards_(sheet, row, totals, byProduct);

    // 月別推移テーブル
    row = writeMonthlyTable_(sheet, row, byMonth);

    // 商品別テーブル
    row = writeProductTable_(sheet, row, byProduct);

    // 在庫アラートセクション
    row = writeInventoryAlert_(sheet, row, byProduct);

    // スプレッドシートネイティブグラフ（月別売上・粗利推移）
    createMonthlyChart_(sheet, byMonth, ss);

    // 最終更新時刻を記録
    sheet.getRange(row + 1, 1).setValue(`最終更新: ${new Date().toLocaleString('ja-JP')}`);
    sheet.getRange(row + 1, 1).setFontColor(COLORS.neutral).setFontSize(9).setFontStyle('italic');

    // TABをDASHBOARDに移動
    ss.setActiveSheet(sheet);

    SpreadsheetApp.getUi().alert('ダッシュボードの生成が完了しました！');
    Logger.log('Dashboard build complete');

  } catch (e) {
    SpreadsheetApp.getUi().alert(`エラー（ダッシュボード生成）: ${e.message}`);
    Logger.log(`エラー詳細: ${e.stack}`);
  }
}

// ==============================
// セクション書き出し（プライベート）
// ==============================

/**
 * タイトル行を書く
 * @private
 */
function writeTitle_(sheet, row, totals) {
  const title = '🛒 Amazon セラー ダッシュボード';
  const period = `集計期間: 2024年1月 〜 2024年3月（Q1）`;

  sheet.getRange(row, 2, 1, 14)
    .merge()
    .setValue(title)
    .setFontSize(18)
    .setFontWeight('bold')
    .setFontColor(COLORS.primary)
    .setVerticalAlignment('middle');
  sheet.setRowHeight(row, 40);
  row++;

  sheet.getRange(row, 2, 1, 14)
    .merge()
    .setValue(period)
    .setFontSize(11)
    .setFontColor(COLORS.neutral);
  sheet.setRowHeight(row, 24);
  row += 2;

  return row;
}

/**
 * KPIカードを横並びで書く
 * @private
 */
function writeKpiCards_(sheet, row, totals, byProduct) {
  // 在庫切れ警告数を算出
  const stockoutWarnings = byProduct.filter(p => p.daysUntilStockout > 0 && p.daysUntilStockout <= 20).length;
  const criticalStockouts = byProduct.filter(p => p.daysUntilStockout > 0 && p.daysUntilStockout <= 10).length;

  const kpis = [
    { label: '純売上', value: formatCurrency_(totals.netRevenue), color: COLORS.kpiRevenue, detail: `(返品控除後)` },
    { label: '粗利', value: formatCurrency_(totals.grossProfit), color: COLORS.kpiProfit, detail: `粗利率: ${totals.grossProfitRate.toFixed(1)}%` },
    { label: 'ACoS（全体）', value: `${totals.acos.toFixed(1)}%`, color: COLORS.kpiAcos, detail: `広告費: ${formatCurrency_(totals.adSpend)}` },
    { label: '総注文件数', value: `${totals.orderCount.toLocaleString()} 件`, color: COLORS.kpiOrder, detail: `${totals.quantity.toLocaleString()} 個販売` },
    { label: '在庫アラート', value: `${stockoutWarnings} 品`, color: stockoutWarnings > 0 ? COLORS.danger : COLORS.success, detail: `内 緊急: ${criticalStockouts} 品` },
  ];

  // ヘッダー（KPIカードタイトル）
  sheet.getRange(row, 2).setValue('■ KPI サマリー').setFontWeight('bold').setFontSize(12);
  row++;

  kpis.forEach((kpi, i) => {
    const col = 2 + i * 3;  // 各カード3列幅

    // カード背景
    sheet.getRange(row, col, 3, 3).merge().setBackground(COLORS.bgCard)
      .setBorder(true, true, true, true, false, false, COLORS.border, SpreadsheetApp.BorderStyle.SOLID);

    // ラベル
    sheet.getRange(row, col).setValue(kpi.label)
      .setFontSize(10).setFontColor(COLORS.neutral).setFontWeight('bold')
      .setHorizontalAlignment('center');
    sheet.setRowHeight(row, 22);

    // 値
    sheet.getRange(row + 1, col).setValue(kpi.value)
      .setFontSize(14).setFontColor(kpi.color).setFontWeight('bold')
      .setHorizontalAlignment('center');
    sheet.setRowHeight(row + 1, 30);

    // 詳細
    sheet.getRange(row + 2, col).setValue(kpi.detail)
      .setFontSize(9).setFontColor(COLORS.neutral)
      .setHorizontalAlignment('center');
    sheet.setRowHeight(row + 2, 20);
  });

  return row + 4;
}

/**
 * 月別推移テーブルを書く
 * @private
 */
function writeMonthlyTable_(sheet, row, byMonth) {
  sheet.getRange(row, 2).setValue('■ 月別推移').setFontWeight('bold').setFontSize(12);
  row++;

  const headers = ['月', '純売上', '粗利', '粗利率', 'Amazon手数料', 'FBA費用', '原価', '広告費', '広告売上', 'ACoS', '注文件数', '販売数量'];
  sheet.getRange(row, 2, 1, headers.length).setValues([headers])
    .setBackground(COLORS.headerBg).setFontColor(COLORS.headerFg).setFontWeight('bold')
    .setHorizontalAlignment('center');
  sheet.setRowHeight(row, 24);
  row++;

  byMonth.forEach((m, i) => {
    const bg = i % 2 === 0 ? COLORS.bgWhite : COLORS.altRow;
    const mRow = [
      `${m.month.replace('-', '年')}月`,
      m.netRevenue, m.grossProfit, m.grossProfitRate / 100,
      m.amazonFee, m.fbaShipping + m.fbaStorage, m.costOfGoods,
      m.adSpend, m.adSales, m.acos / 100,
      m.orderCount, m.quantity
    ];
    const range = sheet.getRange(row, 2, 1, headers.length);
    range.setValues([mRow]).setBackground(bg);

    // 数値フォーマット
    sheet.getRange(row, 3, 1, 3).setNumberFormat('¥#,##0');  // 純売上・粗利
    sheet.getRange(row, 5).setNumberFormat('0.0%');          // 粗利率
    sheet.getRange(row, 6, 1, 4).setNumberFormat('¥#,##0'); // 各コスト
    sheet.getRange(row, 11).setNumberFormat('0.0%');          // ACoS

    row++;
  });

  // 合計行
  const totalRange = sheet.getRange(row, 2, 1, headers.length);
  const sums = byMonth.reduce((acc, m) => {
    acc[0] = '合 計';
    acc[1] += m.netRevenue;
    acc[2] += m.grossProfit;
    acc[3] = byMonth.reduce((s, x) => s + x.netRevenue, 0) > 0
      ? byMonth.reduce((s, x) => s + x.grossProfit, 0) / byMonth.reduce((s, x) => s + x.netRevenue, 0)
      : 0;
    acc[4] += m.amazonFee;
    acc[5] += m.fbaShipping + m.fbaStorage;
    acc[6] += m.costOfGoods;
    acc[7] += m.adSpend;
    acc[8] += m.adSales;
    acc[9] = acc[8] > 0 ? acc[7] / acc[8] : 0;
    acc[10] += m.orderCount;
    acc[11] += m.quantity;
    return acc;
  }, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);

  totalRange.setValues([sums]).setBackground('#e8f0fe').setFontWeight('bold');
  sheet.getRange(row, 3, 1, 3).setNumberFormat('¥#,##0');
  sheet.getRange(row, 5).setNumberFormat('0.0%');
  sheet.getRange(row, 6, 1, 4).setNumberFormat('¥#,##0');
  sheet.getRange(row, 11).setNumberFormat('0.0%');

  return row + 3;
}

/**
 * 商品別パフォーマンステーブルを書く
 * @private
 */
function writeProductTable_(sheet, row, byProduct) {
  sheet.getRange(row, 2).setValue('■ 商品別パフォーマンス（上位20品）').setFontWeight('bold').setFontSize(12);
  row++;

  const headers = ['#', 'ASIN', 'SKU', '商品名', '純売上', '粗利', '粗利率', 'Amazon手数料', '原価', '広告費', 'ACoS', 'FBA在庫数', '在庫日数'];
  sheet.getRange(row, 2, 1, headers.length).setValues([headers])
    .setBackground(COLORS.headerBg).setFontColor(COLORS.headerFg).setFontWeight('bold')
    .setHorizontalAlignment('center');
  sheet.setRowHeight(row, 24);
  row++;

  const top20 = byProduct.slice(0, 20);
  top20.forEach((p, i) => {
    const bg = i % 2 === 0 ? COLORS.bgWhite : COLORS.altRow;
    const pRow = [
      i + 1, p.asin, p.sku, p.name,
      p.netRevenue, p.grossProfit, p.grossProfitRate / 100,
      p.amazonFee, p.costOfGoods, p.adSpend, p.acos / 100,
      p.fbaStock, p.daysUntilStockout
    ];
    sheet.getRange(row, 2, 1, headers.length).setValues([pRow]).setBackground(bg);

    // 数値フォーマット
    sheet.getRange(row, 6, 1, 2).setNumberFormat('¥#,##0');  // 純売上・粗利
    sheet.getRange(row, 8).setNumberFormat('0.0%');           // 粗利率
    sheet.getRange(row, 9, 1, 3).setNumberFormat('¥#,##0');  // コスト系
    sheet.getRange(row, 12).setNumberFormat('0.0%');          // ACoS

    // 粗利率による色分け
    if (p.grossProfitRate >= 20) {
      sheet.getRange(row, 7).setFontColor(COLORS.success);
    } else if (p.grossProfitRate >= 10) {
      sheet.getRange(row, 7).setFontColor(COLORS.warning);
    } else {
      sheet.getRange(row, 7).setFontColor(COLORS.danger);
    }

    // 在庫日数による色分け
    if (p.daysUntilStockout > 0 && p.daysUntilStockout <= 10) {
      sheet.getRange(row, 14).setBackground('#fce8e6').setFontColor(COLORS.danger).setFontWeight('bold');
    } else if (p.daysUntilStockout > 0 && p.daysUntilStockout <= 20) {
      sheet.getRange(row, 14).setBackground('#fef7e0').setFontColor(COLORS.warning);
    }

    row++;
  });

  return row + 2;
}

/**
 * 在庫アラートセクションを書く
 * @private
 */
function writeInventoryAlert_(sheet, row, byProduct) {
  const alertItems = byProduct.filter(p => p.daysUntilStockout > 0 && p.daysUntilStockout <= 20)
    .sort((a, b) => a.daysUntilStockout - b.daysUntilStockout);

  if (alertItems.length === 0) {
    sheet.getRange(row, 2).setValue('■ 在庫アラート: なし（全商品正常）')
      .setFontWeight('bold').setFontSize(12).setFontColor(COLORS.success);
    return row + 2;
  }

  sheet.getRange(row, 2).setValue(`⚠️ 在庫アラート（${alertItems.length} 品 — 要注意）`)
    .setFontWeight('bold').setFontSize(12).setFontColor(COLORS.danger);
  row++;

  const headers = ['緊急度', 'ASIN', 'SKU', '商品名', 'FBA在庫数', '在庫切れ予測日数', '平均販売速度/日'];
  sheet.getRange(row, 2, 1, headers.length).setValues([headers])
    .setBackground('#c5221f').setFontColor('#ffffff').setFontWeight('bold');
  row++;

  alertItems.forEach((p, i) => {
    const isCritical = p.daysUntilStockout <= 10;
    const level = isCritical ? '🔴 緊急' : '🟡 注意';
    const bg = isCritical ? '#fce8e6' : '#fef7e0';
    sheet.getRange(row, 2, 1, headers.length).setValues([[
      level, p.asin, p.sku, p.name,
      p.fbaStock, p.daysUntilStockout, ''
    ]]).setBackground(bg);
    if (isCritical) sheet.getRange(row, 7).setFontColor(COLORS.danger).setFontWeight('bold');
    row++;
  });

  return row + 2;
}

/**
 * 月別売上・粗利推移グラフをシートに追加する
 * @private
 */
function createMonthlyChart_(dashSheet, byMonth, ss) {
  // 既存グラフを削除
  dashSheet.getCharts().forEach(chart => dashSheet.removeChart(chart));

  // グラフ用の一時的なデータ範囲を別シートに作成
  const tempSheetName = '__CHART_DATA__';
  let tempSheet = ss.getSheetByName(tempSheetName);
  if (!tempSheet) {
    tempSheet = ss.insertSheet(tempSheetName);
  }
  tempSheet.clearContents();

  // グラフデータを書き出す
  tempSheet.getRange(1, 1, 1, 4).setValues([['月', '純売上', '粗利', '広告費']]);
  byMonth.forEach((m, i) => {
    tempSheet.getRange(i + 2, 1, 1, 4).setValues([
      [`${m.month.replace('-', '/')}`, m.netRevenue, m.grossProfit, m.adSpend]
    ]);
  });

  // グラフ作成
  const dataRange = tempSheet.getRange(1, 1, byMonth.length + 1, 4);
  const chart = dashSheet.newChart()
    .setChartType(Charts.ChartType.COMBO)
    .addRange(dataRange)
    .setOption('title', '月別 売上・粗利・広告費 推移')
    .setOption('titleTextStyle', { fontSize: 13, bold: true })
    .setOption('legend', { position: 'bottom' })
    .setOption('seriesType', 'bars')
    .setOption('series', {
      0: { type: 'bars', color: '#1a73e8', targetAxisIndex: 0 },
      1: { type: 'bars', color: '#137333', targetAxisIndex: 0 },
      2: { type: 'line', color: '#e8710a', targetAxisIndex: 1 },
    })
    .setOption('vAxes', {
      0: { title: '売上・粗利（円）', format: '¥#,##0' },
      1: { title: '広告費（円）', format: '¥#,##0' },
    })
    .setPosition(5, 16, 0, 0)
    .setNumRows(byMonth.length + 1)
    .setNumColumns(4)
    .build();

  dashSheet.insertChart(chart);

  // 一時シートを非表示にする
  tempSheet.hideSheet();
  Logger.log('月別推移グラフを生成しました');
}

// ==============================
// ユーティリティ（プライベート）
// ==============================

/** 通貨フォーマット（表示用文字列） */
function formatCurrency_(value) {
  return '¥' + Math.round(value).toLocaleString('ja-JP');
}

/** シートを取得または作成する */
function getOrCreateSheet_(ss, sheetName) {
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
  }
  return sheet;
}
