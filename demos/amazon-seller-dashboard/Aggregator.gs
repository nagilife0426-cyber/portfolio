/**
 * Aggregator.gs
 * RAW_売上・RAW_広告・RAW_在庫シートのデータを商品別・月別に集計するモジュール
 *
 * 集計指標:
 *   - 売上高（返品控除後）
 *   - 注文数・返品数
 *   - Amazon手数料 / FBA配送料 / FBA保管料
 *   - 原価合計
 *   - 広告費 / 広告売上 / ACoS
 *   - 粗利（= 売上 - 原価 - Amazon手数料 - FBA配送料 - FBA保管料 - 広告費）
 *   - 粗利率
 *   - 在庫状況（現在の在庫数・在庫切れ予測日数）
 */

// ==============================
// 集計マスタ定義
// ==============================

/** 月名表示用 */
const MONTH_LABELS = {
  '2024-01': '2024年1月',
  '2024-02': '2024年2月',
  '2024-03': '2024年3月',
};

// ==============================
// メイン集計関数
// ==============================

/**
 * 全データを集計してSUMMARYシートを更新する
 * ダッシュボード生成前に必ず呼ぶ
 *
 * @returns {Object} 集計結果オブジェクト { byProduct, byMonth, totals }
 */
function runAggregation() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  try {
    // RAWシートの存在確認
    const salesSheet = ss.getSheetByName('RAW_売上');
    const adSheet = ss.getSheetByName('RAW_広告');
    const invSheet = ss.getSheetByName('RAW_在庫');

    if (!salesSheet) {
      throw new Error('RAW_売上シートが見つかりません。先にレポートを取り込んでください。');
    }

    // 各シートのデータを読み込む
    const salesData = readSheetData_(salesSheet);
    const adData = adSheet ? readSheetData_(adSheet) : [];
    const invData = invSheet ? readSheetData_(invSheet) : [];

    // 広告データをASIN→月→データのMapに変換
    const adMap = buildAdMap_(adData);

    // 在庫データをASIN→データのMapに変換
    const invMap = buildInvMap_(invData);

    // 商品別・月別に売上データを集計
    const byProduct = aggregateByProduct_(salesData, adMap, invMap);
    const byMonth = aggregateByMonth_(salesData, adData);
    const totals = calculateTotals_(byProduct);

    // 集計結果をSUMMARYシートに書き出す
    writeSummarySheet_(ss, byProduct, byMonth, totals);

    Logger.log('集計完了');
    return { byProduct, byMonth, totals };

  } catch (e) {
    SpreadsheetApp.getUi().alert(`エラー（集計処理）: ${e.message}`);
    Logger.log(`エラー詳細: ${e.stack}`);
    return null;
  }
}

// ==============================
// 集計ロジック（プライベート）
// ==============================

/**
 * 商品（ASIN）別に集計する
 * @private
 */
function aggregateByProduct_(salesData, adMap, invMap) {
  // ASINをキーにした集計バッファ
  const buffer = {};

  for (const row of salesData) {
    const asin = row['ASIN'] || '';
    const sku = row['SKU'] || '';
    const name = row['商品名'] || '';
    if (!asin) continue;

    if (!buffer[asin]) {
      buffer[asin] = {
        asin, sku, name,
        revenue: 0,          // 売上高（返品前）
        returnAmount: 0,     // 返品額
        netRevenue: 0,       // 純売上（返品控除後）
        orderCount: 0,       // 注文件数
        quantity: 0,         // 販売数量
        returnQty: 0,        // 返品数
        amazonFee: 0,        // Amazon手数料合計
        fbaShipping: 0,      // FBA配送料合計
        fbaStorage: 0,       // FBA保管料合計
        costOfGoods: 0,      // 原価合計
        adSpend: 0,          // 広告費合計
        adSales: 0,          // 広告売上合計
        grossProfit: 0,      // 粗利
        grossProfitRate: 0,  // 粗利率(%)
        acos: 0,             // ACoS(%)
        fbaStock: 0,         // 現在FBA在庫
        daysUntilStockout: 0,// 在庫切れ予測日数
        monthlyData: {},     // 月別内訳
      };
    }

    const b = buffer[asin];
    const revenue = toNum_(row['売上高']);
    const returnAmount = toNum_(row['返品額']);
    const qty = toNum_(row['数量']);
    const returnQty = toNum_(row['返品数']);

    b.revenue += revenue;
    b.returnAmount += returnAmount;
    b.netRevenue += (revenue - returnAmount);
    b.orderCount += 1;
    b.quantity += qty;
    b.returnQty += returnQty;
    b.amazonFee += toNum_(row['Amazon手数料']);
    b.fbaShipping += toNum_(row['FBA配送料']);
    b.fbaStorage += toNum_(row['FBA保管料']);
    b.costOfGoods += toNum_(row['原価']);

    // 月別内訳の更新
    const month = extractMonth_(row['注文日']);
    if (month) {
      if (!b.monthlyData[month]) {
        b.monthlyData[month] = { revenue: 0, quantity: 0, grossProfit: 0, adSpend: 0 };
      }
      b.monthlyData[month].revenue += (revenue - returnAmount);
      b.monthlyData[month].quantity += qty;
    }
  }

  // 広告データをマージ
  for (const [asin, months] of Object.entries(adMap)) {
    if (!buffer[asin]) continue;
    for (const [month, ad] of Object.entries(months)) {
      buffer[asin].adSpend += ad.adSpend;
      buffer[asin].adSales += ad.adSales;
      if (buffer[asin].monthlyData[month]) {
        buffer[asin].monthlyData[month].adSpend += ad.adSpend;
      }
    }
  }

  // 在庫データをマージ
  for (const [asin, inv] of Object.entries(invMap)) {
    if (!buffer[asin]) continue;
    buffer[asin].fbaStock = inv.fbaStock;
    buffer[asin].daysUntilStockout = inv.daysUntilStockout;
  }

  // 粗利・粗利率・ACoS・月別粗利を計算
  for (const b of Object.values(buffer)) {
    // 粗利 = 純売上 - 原価 - Amazon手数料 - FBA配送料 - FBA保管料 - 広告費
    b.grossProfit = b.netRevenue - b.costOfGoods - b.amazonFee - b.fbaShipping - b.fbaStorage - b.adSpend;
    b.grossProfitRate = b.netRevenue > 0
      ? Math.round(b.grossProfit / b.netRevenue * 10000) / 100
      : 0;
    // ACoS = 広告費 / 広告売上 * 100
    b.acos = b.adSales > 0
      ? Math.round(b.adSpend / b.adSales * 10000) / 100
      : 0;

    // 月別粗利の計算（簡易版: 月ごとの比率で按分）
    const totalRevenue = b.netRevenue || 1;
    for (const [month, md] of Object.entries(b.monthlyData)) {
      const ratio = md.revenue / totalRevenue;
      md.grossProfit = Math.round(
        (md.revenue - (b.costOfGoods + b.amazonFee + b.fbaShipping + b.fbaStorage + b.adSpend) * ratio)
      );
      md.adSpend = md.adSpend || 0;
    }
  }

  // 売上高降順でソートして返す
  return Object.values(buffer).sort((a, b) => b.netRevenue - a.netRevenue);
}

/**
 * 月別に集計する
 * @private
 */
function aggregateByMonth_(salesData, adData) {
  const buffer = {};

  for (const row of salesData) {
    const month = extractMonth_(row['注文日']);
    if (!month) continue;

    if (!buffer[month]) {
      buffer[month] = {
        month,
        revenue: 0, returnAmount: 0, netRevenue: 0,
        quantity: 0, orderCount: 0, returnQty: 0,
        amazonFee: 0, fbaShipping: 0, fbaStorage: 0,
        costOfGoods: 0, adSpend: 0, adSales: 0,
        grossProfit: 0, grossProfitRate: 0, acos: 0,
      };
    }

    const b = buffer[month];
    const revenue = toNum_(row['売上高']);
    const returnAmount = toNum_(row['返品額']);

    b.revenue += revenue;
    b.returnAmount += returnAmount;
    b.netRevenue += (revenue - returnAmount);
    b.orderCount += 1;
    b.quantity += toNum_(row['数量']);
    b.returnQty += toNum_(row['返品数']);
    b.amazonFee += toNum_(row['Amazon手数料']);
    b.fbaShipping += toNum_(row['FBA配送料']);
    b.fbaStorage += toNum_(row['FBA保管料']);
    b.costOfGoods += toNum_(row['原価']);
  }

  // 広告データを月別にマージ
  for (const row of adData) {
    // 広告レポートは期間ベースなので開始月を使う
    const month = extractMonth_(row['期間開始日']);
    if (!month || !buffer[month]) continue;
    buffer[month].adSpend += toNum_(row['広告費']);
    buffer[month].adSales += toNum_(row['広告売上']);
  }

  // 粗利・粗利率・ACoS計算
  for (const b of Object.values(buffer)) {
    b.grossProfit = b.netRevenue - b.costOfGoods - b.amazonFee - b.fbaShipping - b.fbaStorage - b.adSpend;
    b.grossProfitRate = b.netRevenue > 0
      ? Math.round(b.grossProfit / b.netRevenue * 10000) / 100
      : 0;
    b.acos = b.adSales > 0
      ? Math.round(b.adSpend / b.adSales * 10000) / 100
      : 0;
  }

  return Object.values(buffer).sort((a, b) => a.month.localeCompare(b.month));
}

/**
 * 全商品の合計を計算する
 * @private
 */
function calculateTotals_(byProduct) {
  const totals = {
    revenue: 0, returnAmount: 0, netRevenue: 0,
    quantity: 0, orderCount: 0, returnQty: 0,
    amazonFee: 0, fbaShipping: 0, fbaStorage: 0,
    costOfGoods: 0, adSpend: 0, adSales: 0,
    grossProfit: 0, grossProfitRate: 0, acos: 0,
    productCount: byProduct.length,
  };

  for (const p of byProduct) {
    totals.revenue += p.revenue;
    totals.returnAmount += p.returnAmount;
    totals.netRevenue += p.netRevenue;
    totals.quantity += p.quantity;
    totals.orderCount += p.orderCount;
    totals.returnQty += p.returnQty;
    totals.amazonFee += p.amazonFee;
    totals.fbaShipping += p.fbaShipping;
    totals.fbaStorage += p.fbaStorage;
    totals.costOfGoods += p.costOfGoods;
    totals.adSpend += p.adSpend;
    totals.adSales += p.adSales;
    totals.grossProfit += p.grossProfit;
  }

  totals.grossProfitRate = totals.netRevenue > 0
    ? Math.round(totals.grossProfit / totals.netRevenue * 10000) / 100
    : 0;
  totals.acos = totals.adSales > 0
    ? Math.round(totals.adSpend / totals.adSales * 10000) / 100
    : 0;

  return totals;
}

// ==============================
// サマリーシート書き出し
// ==============================

/**
 * 集計結果をSUMMARYシートに書き出す
 * @private
 */
function writeSummarySheet_(ss, byProduct, byMonth, totals) {
  const sheetName = 'SUMMARY';
  let sheet = getOrCreateSheet_(ss, sheetName);
  sheet.clearContents();
  sheet.clearFormats();

  let currentRow = 1;

  // --- セクション1: 全体サマリー ---
  sheet.getRange(currentRow, 1).setValue('■ 全体サマリー').setFontWeight('bold').setFontSize(12);
  currentRow++;

  const summaryHeaders = ['指標', '金額・数値'];
  sheet.getRange(currentRow, 1, 1, 2).setValues([summaryHeaders])
    .setBackground('#1a73e8').setFontColor('#ffffff').setFontWeight('bold');
  currentRow++;

  const summaryRows = [
    ['純売上（返品控除後）', totals.netRevenue],
    ['総注文件数', totals.orderCount],
    ['総販売数量', totals.quantity],
    ['返品数', totals.returnQty],
    ['Amazon手数料合計', totals.amazonFee],
    ['FBA配送料合計', totals.fbaShipping],
    ['FBA保管料合計', totals.fbaStorage],
    ['原価合計', totals.costOfGoods],
    ['広告費合計', totals.adSpend],
    ['広告売上合計', totals.adSales],
    ['粗利合計', totals.grossProfit],
    ['粗利率', totals.grossProfitRate / 100],  // パーセント表示用
    ['ACoS（全体）', totals.acos / 100],
    ['取扱商品数', totals.productCount],
  ];

  sheet.getRange(currentRow, 1, summaryRows.length, 2).setValues(summaryRows);
  // 金額行に通貨フォーマット
  [0,4,5,6,7,8,9,10].forEach(offset => {
    sheet.getRange(currentRow + offset, 2).setNumberFormat('¥#,##0');
  });
  // パーセント行
  [11,12].forEach(offset => {
    sheet.getRange(currentRow + offset, 2).setNumberFormat('0.0%');
  });
  currentRow += summaryRows.length + 2;

  // --- セクション2: 月別集計 ---
  sheet.getRange(currentRow, 1).setValue('■ 月別集計').setFontWeight('bold').setFontSize(12);
  currentRow++;

  const monthHeaders = ['月', '純売上', '販売数量', 'Amazon手数料', 'FBA費用合計', '原価', '広告費', '広告売上', '粗利', '粗利率', 'ACoS'];
  sheet.getRange(currentRow, 1, 1, monthHeaders.length).setValues([monthHeaders])
    .setBackground('#1a73e8').setFontColor('#ffffff').setFontWeight('bold');
  currentRow++;

  for (const m of byMonth) {
    const mRow = [
      MONTH_LABELS[m.month] || m.month,
      m.netRevenue,
      m.quantity,
      m.amazonFee,
      m.fbaShipping + m.fbaStorage,
      m.costOfGoods,
      m.adSpend,
      m.adSales,
      m.grossProfit,
      m.grossProfitRate / 100,
      m.acos / 100,
    ];
    sheet.getRange(currentRow, 1, 1, mRow.length).setValues([mRow]);
    // 金額列
    [2,4,5,6,7,8,9].forEach(col => {
      sheet.getRange(currentRow, col).setNumberFormat('¥#,##0');
    });
    // パーセント列
    [10, 11].forEach(col => {
      sheet.getRange(currentRow, col).setNumberFormat('0.0%');
    });
    currentRow++;
  }
  currentRow += 2;

  // --- セクション3: 商品別集計 ---
  sheet.getRange(currentRow, 1).setValue('■ 商品別集計（売上高順）').setFontWeight('bold').setFontSize(12);
  currentRow++;

  const productHeaders = [
    'ASIN', 'SKU', '商品名', '純売上', '数量', '返品数',
    'Amazon手数料', 'FBA費用合計', '原価', '広告費', '広告売上',
    '粗利', '粗利率', 'ACoS', 'FBA在庫数', '在庫切れ予測日数'
  ];
  sheet.getRange(currentRow, 1, 1, productHeaders.length).setValues([productHeaders])
    .setBackground('#1a73e8').setFontColor('#ffffff').setFontWeight('bold');
  currentRow++;

  for (const p of byProduct) {
    const pRow = [
      p.asin, p.sku, p.name,
      p.netRevenue, p.quantity, p.returnQty,
      p.amazonFee, p.fbaShipping + p.fbaStorage, p.costOfGoods,
      p.adSpend, p.adSales,
      p.grossProfit, p.grossProfitRate / 100, p.acos / 100,
      p.fbaStock, p.daysUntilStockout
    ];
    sheet.getRange(currentRow, 1, 1, pRow.length).setValues([pRow]);
    // 金額列
    [4,7,8,9,10,11,12].forEach(col => {
      sheet.getRange(currentRow, col).setNumberFormat('¥#,##0');
    });
    // パーセント列
    [13, 14].forEach(col => {
      sheet.getRange(currentRow, col).setNumberFormat('0.0%');
    });
    // 在庫切れ警告（10日以内を赤背景）
    const daysUntilStockout = p.daysUntilStockout;
    if (daysUntilStockout > 0 && daysUntilStockout <= 10) {
      sheet.getRange(currentRow, 16).setBackground('#fce8e6').setFontColor('#c5221f');
    } else if (daysUntilStockout > 0 && daysUntilStockout <= 20) {
      sheet.getRange(currentRow, 16).setBackground('#fef7e0').setFontColor('#b06000');
    }
    currentRow++;
  }

  sheet.autoResizeColumns(1, productHeaders.length);
  Logger.log('SUMMARYシートの書き出し完了');
}

// ==============================
// ヘルパー（プライベート）
// ==============================

/**
 * シートのデータを {ヘッダー名: 値} の配列に変換する
 * @private
 */
function readSheetData_(sheet) {
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];

  const headers = values[0].map(h => h.toString().trim());
  const result = [];

  for (let i = 1; i < values.length; i++) {
    const row = {};
    headers.forEach((h, j) => {
      row[h] = values[i][j] !== undefined ? values[i][j].toString().trim() : '';
    });
    if (Object.values(row).some(v => v !== '')) {
      result.push(row);
    }
  }
  return result;
}

/**
 * 広告データをASIN → 月 → 集計値 のネストMapに変換する
 * @private
 */
function buildAdMap_(adData) {
  const map = {};
  for (const row of adData) {
    const asin = row['ASIN'] || '';
    const month = extractMonth_(row['期間開始日']);
    if (!asin || !month) continue;

    if (!map[asin]) map[asin] = {};
    if (!map[asin][month]) map[asin][month] = { adSpend: 0, adSales: 0 };
    map[asin][month].adSpend += toNum_(row['広告費']);
    map[asin][month].adSales += toNum_(row['広告売上']);
  }
  return map;
}

/**
 * 在庫データをASIN → データ のMapに変換する
 * @private
 */
function buildInvMap_(invData) {
  const map = {};
  for (const row of invData) {
    const asin = row['ASIN'] || '';
    if (!asin) continue;
    map[asin] = {
      fbaStock: toNum_(row['FBA在庫数']),
      daysUntilStockout: toNum_(row['推定在庫切れまでの日数']),
    };
  }
  return map;
}

/**
 * 日付文字列から年月（YYYY-MM）を抽出する
 * @private
 */
function extractMonth_(dateStr) {
  if (!dateStr) return null;
  const str = dateStr.toString().trim();
  // YYYY-MM-DD 形式
  const match = str.match(/^(\d{4}-\d{2})/);
  if (match) return match[1];
  // Date オブジェクトの場合
  if (dateStr instanceof Date) {
    const y = dateStr.getFullYear();
    const m = String(dateStr.getMonth() + 1).padStart(2, '0');
    return `${y}-${m}`;
  }
  return null;
}

/** 文字列を数値に変換（Importer.gsと同じロジック） */
function toNum_(str) {
  if (str === '' || str === null || str === undefined) return 0;
  const cleaned = str.toString().replace(/[,¥$%\s]/g, '');
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

/** シートを取得または作成する */
function getOrCreateSheet_(ss, sheetName) {
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
  }
  return sheet;
}
