/**
 * Importer.gs
 * Amazonレポート（CSV形式）をスプレッドシートに取り込み、列マッピングを行うモジュール
 *
 * 対応レポート種別:
 *   1. 売上レポート（注文ベース）
 *   2. 広告レポート（スポンサープロダクト）
 *   3. 在庫レポート
 */

// ==============================
// 列名マッピング定義（表記ゆれに対応）
// ==============================

/** 売上レポートの列マッピング（候補名 → 標準名） */
const SALES_COLUMN_MAP = {
  // 日付列
  orderDate: ['注文日', 'order date', 'date', '日付', 'purchase-date'],
  // 商品識別
  asin: ['ASIN', 'asin', '商品ASIN'],
  sku: ['SKU', 'sku', 'seller-sku', 'セラーSKU'],
  productName: ['商品名', 'product name', 'item-name', 'title', '商品タイトル'],
  // 注文情報
  orderId: ['注文番号', 'order-id', 'amazon-order-id', '注文ID'],
  channel: ['販売チャネル', 'channel', 'sales-channel'],
  fulfillment: ['フルフィルメント', 'fulfillment-channel', 'ship-service-level'],
  // 売上・数量
  quantity: ['数量', 'quantity', 'quantity-purchased', '注文数'],
  revenue: ['売上高', '売上', 'item-price', 'revenue', '商品価格', '商品代金'],
  // 手数料
  feeRate: ['Amazon手数料率(%)', '手数料率', 'referral-fee-rate'],
  amazonFee: ['Amazon手数料', '手数料', 'referral-fee', 'amazon-fees'],
  fbaShipping: ['FBA配送料', 'fba-per-unit-fulfillment-fee', 'shipping'],
  fbaStorage: ['FBA保管料', 'storage-fee'],
  // 原価・広告
  costOfGoods: ['原価', 'cost', 'unit-cost', '仕入原価'],
  adCost: ['広告費割当', '広告費', 'ad-spend'],
  // 返品
  returnQty: ['返品数', 'returns', 'return-quantity'],
  returnAmount: ['返品額', 'return-amount', '返金額'],
};

/** 広告レポートの列マッピング */
const AD_COLUMN_MAP = {
  campaignName: ['キャンペーン名', 'Campaign Name', 'campaign-name'],
  adGroupName: ['広告グループ名', 'Ad Group Name', 'adgroup-name'],
  asin: ['ASIN', 'asin', 'advertised-asin'],
  sku: ['SKU', 'sku', 'advertised-sku'],
  productName: ['商品名', 'product name', 'advertised-product-name'],
  startDate: ['期間開始日', 'Start Date', 'start-date'],
  endDate: ['期間終了日', 'End Date', 'end-date'],
  impressions: ['インプレッション数', 'Impressions', 'impressions'],
  clicks: ['クリック数', 'Clicks', 'clicks'],
  ctr: ['クリック率(%)', 'CTR', 'click-through-rate'],
  adSpend: ['広告費', 'Spend', 'spend', '広告費用'],
  adSales: ['広告売上', 'Sales', 'attributed-sales-14d'],
  acos: ['ACoS(%)', 'ACoS', 'advertising-cost-of-sales'],
  roas: ['ROAS', 'Return on Ad Spend'],
};

/** 在庫レポートの列マッピング */
const INVENTORY_COLUMN_MAP = {
  asin: ['ASIN', 'asin'],
  sku: ['SKU', 'sku'],
  productName: ['商品名', 'product-name', 'item-name'],
  fbaStock: ['FBA在庫数', 'afn-fulfillable-quantity', 'fulfillable-quantity'],
  availableStock: ['出荷可能在庫', 'available-quantity', 'afn-warehouse-quantity'],
  reservedStock: ['予約済み在庫', 'reserved-quantity'],
  inboundStock: ['仕入中在庫', 'afn-inbound-shipped-quantity'],
  salesVelocity: ['平均販売速度/日', 'units-sold-last-30-days'],
  daysUntilStockout: ['推定在庫切れまでの日数', 'days-of-supply'],
  lastReceived: ['最終入庫日', 'last-received-date'],
  unitCost: ['原価/個', 'unit-cost'],
  storageFeePm: ['FBA保管手数料/月', 'estimated-storage-fee'],
};

// ==============================
// メイン取込関数
// ==============================

/**
 * 売上CSVをシートに取り込む
 * Googleドライブ上のCSVファイルIDを指定して読み込む
 *
 * @param {string} fileId - Google Drive上のCSVファイルID
 * @returns {Sheet} 取り込んだデータが入ったシート
 */
function importSalesReport(fileId) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheetName = 'RAW_売上';

  // 既存シートをクリアまたは新規作成
  let sheet = getOrCreateSheet_(ss, sheetName);
  sheet.clearContents();

  try {
    const csvData = loadCsvFromDrive_(fileId);
    if (!csvData || csvData.length === 0) {
      throw new Error('CSVファイルが空か、読み込めませんでした。');
    }

    const headers = csvData[0];
    const colIdx = buildColumnIndex_(headers, SALES_COLUMN_MAP);

    validateRequiredColumns_(colIdx, ['asin', 'revenue', 'quantity'], 'sales');

    // 標準ヘッダー行を書き込む
    const standardHeaders = [
      '注文日', 'ASIN', 'SKU', '商品名', '注文番号', 'チャネル', 'フルフィルメント',
      '数量', '売上高', 'Amazon手数料率(%)', 'Amazon手数料', 'FBA配送料', 'FBA保管料',
      '原価', '広告費割当', '返品数', '返品額'
    ];
    sheet.getRange(1, 1, 1, standardHeaders.length).setValues([standardHeaders]);
    sheet.getRange(1, 1, 1, standardHeaders.length)
      .setBackground('#1a73e8')
      .setFontColor('#ffffff')
      .setFontWeight('bold');

    // データ行を変換して書き込む
    const outputRows = [];
    for (let i = 1; i < csvData.length; i++) {
      const row = csvData[i];
      if (row.every(cell => cell === '')) continue; // 空行スキップ

      outputRows.push([
        getCell_(row, colIdx.orderDate),
        getCell_(row, colIdx.asin),
        getCell_(row, colIdx.sku),
        getCell_(row, colIdx.productName),
        getCell_(row, colIdx.orderId),
        getCell_(row, colIdx.channel),
        getCell_(row, colIdx.fulfillment),
        toNum_(getCell_(row, colIdx.quantity)),
        toNum_(getCell_(row, colIdx.revenue)),
        toNum_(getCell_(row, colIdx.feeRate)),
        toNum_(getCell_(row, colIdx.amazonFee)),
        toNum_(getCell_(row, colIdx.fbaShipping)),
        toNum_(getCell_(row, colIdx.fbaStorage)),
        toNum_(getCell_(row, colIdx.costOfGoods)),
        toNum_(getCell_(row, colIdx.adCost)),
        toNum_(getCell_(row, colIdx.returnQty)),
        toNum_(getCell_(row, colIdx.returnAmount)),
      ]);
    }

    if (outputRows.length > 0) {
      sheet.getRange(2, 1, outputRows.length, standardHeaders.length).setValues(outputRows);
    }

    // 書式設定
    sheet.autoResizeColumns(1, standardHeaders.length);
    formatSalesSheet_(sheet, outputRows.length);

    Logger.log(`売上レポート取込完了: ${outputRows.length} 件`);
    return sheet;

  } catch (e) {
    SpreadsheetApp.getUi().alert(`エラー（売上レポート取込）: ${e.message}`);
    Logger.log(`エラー詳細: ${e.stack}`);
    return null;
  }
}

/**
 * 広告CSVをシートに取り込む
 *
 * @param {string} fileId - Google Drive上のCSVファイルID
 * @returns {Sheet} 取り込んだシート
 */
function importAdReport(fileId) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheetName = 'RAW_広告';

  let sheet = getOrCreateSheet_(ss, sheetName);
  sheet.clearContents();

  try {
    const csvData = loadCsvFromDrive_(fileId);
    if (!csvData || csvData.length === 0) {
      throw new Error('CSVファイルが空か、読み込めませんでした。');
    }

    const headers = csvData[0];
    const colIdx = buildColumnIndex_(headers, AD_COLUMN_MAP);

    validateRequiredColumns_(colIdx, ['asin', 'adSpend', 'adSales'], 'ad');

    const standardHeaders = [
      'キャンペーン名', '広告グループ名', 'ASIN', 'SKU', '商品名',
      '期間開始日', '期間終了日', 'インプレッション数', 'クリック数', 'クリック率(%)',
      '広告費', '広告売上', 'ACoS(%)', 'ROAS'
    ];
    sheet.getRange(1, 1, 1, standardHeaders.length).setValues([standardHeaders]);
    sheet.getRange(1, 1, 1, standardHeaders.length)
      .setBackground('#e8710a')
      .setFontColor('#ffffff')
      .setFontWeight('bold');

    const outputRows = [];
    for (let i = 1; i < csvData.length; i++) {
      const row = csvData[i];
      if (row.every(cell => cell === '')) continue;

      const adSpend = toNum_(getCell_(row, colIdx.adSpend));
      const adSales = toNum_(getCell_(row, colIdx.adSales));
      // ACoS・ROASが存在しない場合は計算
      const acos = toNum_(getCell_(row, colIdx.acos)) ||
                   (adSales > 0 ? Math.round(adSpend / adSales * 10000) / 100 : 0);
      const roas = toNum_(getCell_(row, colIdx.roas)) ||
                   (adSpend > 0 ? Math.round(adSales / adSpend * 100) / 100 : 0);

      outputRows.push([
        getCell_(row, colIdx.campaignName),
        getCell_(row, colIdx.adGroupName),
        getCell_(row, colIdx.asin),
        getCell_(row, colIdx.sku),
        getCell_(row, colIdx.productName),
        getCell_(row, colIdx.startDate),
        getCell_(row, colIdx.endDate),
        toNum_(getCell_(row, colIdx.impressions)),
        toNum_(getCell_(row, colIdx.clicks)),
        toNum_(getCell_(row, colIdx.ctr)),
        adSpend,
        adSales,
        acos,
        roas,
      ]);
    }

    if (outputRows.length > 0) {
      sheet.getRange(2, 1, outputRows.length, standardHeaders.length).setValues(outputRows);
    }

    sheet.autoResizeColumns(1, standardHeaders.length);
    Logger.log(`広告レポート取込完了: ${outputRows.length} 件`);
    return sheet;

  } catch (e) {
    SpreadsheetApp.getUi().alert(`エラー（広告レポート取込）: ${e.message}`);
    Logger.log(`エラー詳細: ${e.stack}`);
    return null;
  }
}

/**
 * 在庫CSVをシートに取り込む
 *
 * @param {string} fileId - Google Drive上のCSVファイルID
 * @returns {Sheet} 取り込んだシート
 */
function importInventoryReport(fileId) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheetName = 'RAW_在庫';

  let sheet = getOrCreateSheet_(ss, sheetName);
  sheet.clearContents();

  try {
    const csvData = loadCsvFromDrive_(fileId);
    if (!csvData || csvData.length === 0) {
      throw new Error('CSVファイルが空か、読み込めませんでした。');
    }

    const headers = csvData[0];
    const colIdx = buildColumnIndex_(headers, INVENTORY_COLUMN_MAP);

    validateRequiredColumns_(colIdx, ['asin', 'fbaStock'], 'inventory');

    const standardHeaders = [
      'ASIN', 'SKU', '商品名', 'FBA在庫数', '出荷可能在庫', '予約済み在庫',
      '仕入中在庫', '平均販売速度/日', '推定在庫切れまでの日数', '最終入庫日',
      '原価/個', 'FBA保管手数料/月'
    ];
    sheet.getRange(1, 1, 1, standardHeaders.length).setValues([standardHeaders]);
    sheet.getRange(1, 1, 1, standardHeaders.length)
      .setBackground('#137333')
      .setFontColor('#ffffff')
      .setFontWeight('bold');

    const outputRows = [];
    for (let i = 1; i < csvData.length; i++) {
      const row = csvData[i];
      if (row.every(cell => cell === '')) continue;

      outputRows.push([
        getCell_(row, colIdx.asin),
        getCell_(row, colIdx.sku),
        getCell_(row, colIdx.productName),
        toNum_(getCell_(row, colIdx.fbaStock)),
        toNum_(getCell_(row, colIdx.availableStock)),
        toNum_(getCell_(row, colIdx.reservedStock)),
        toNum_(getCell_(row, colIdx.inboundStock)),
        toNum_(getCell_(row, colIdx.salesVelocity)),
        toNum_(getCell_(row, colIdx.daysUntilStockout)),
        getCell_(row, colIdx.lastReceived),
        toNum_(getCell_(row, colIdx.unitCost)),
        toNum_(getCell_(row, colIdx.storageFeePm)),
      ]);
    }

    if (outputRows.length > 0) {
      sheet.getRange(2, 1, outputRows.length, standardHeaders.length).setValues(outputRows);
    }

    sheet.autoResizeColumns(1, standardHeaders.length);
    Logger.log(`在庫レポート取込完了: ${outputRows.length} 件`);
    return sheet;

  } catch (e) {
    SpreadsheetApp.getUi().alert(`エラー（在庫レポート取込）: ${e.message}`);
    Logger.log(`エラー詳細: ${e.stack}`);
    return null;
  }
}

// ==============================
// ファイル選択ダイアログ経由での取込
// ==============================

/**
 * Google Drive ピッカーでCSVを選択して売上レポートを取り込む
 * Menu.gsのonImportSalesReportClick()から呼ばれる
 */
function importSalesReportByPicker() {
  const fileId = showDriveFilePicker_('売上レポートCSVを選択してください');
  if (!fileId) return;
  const sheet = importSalesReport(fileId);
  if (sheet) {
    SpreadsheetApp.getUi().alert('売上レポートの取込が完了しました。');
  }
}

/**
 * Google Drive ピッカーでCSVを選択して広告レポートを取り込む
 */
function importAdReportByPicker() {
  const fileId = showDriveFilePicker_('広告レポートCSVを選択してください');
  if (!fileId) return;
  const sheet = importAdReport(fileId);
  if (sheet) {
    SpreadsheetApp.getUi().alert('広告レポートの取込が完了しました。');
  }
}

/**
 * Google Drive ピッカーでCSVを選択して在庫レポートを取り込む
 */
function importInventoryReportByPicker() {
  const fileId = showDriveFilePicker_('在庫レポートCSVを選択してください');
  if (!fileId) return;
  const sheet = importInventoryReport(fileId);
  if (sheet) {
    SpreadsheetApp.getUi().alert('在庫レポートの取込が完了しました。');
  }
}

// ==============================
// ユーティリティ関数（プライベート）
// ==============================

/**
 * DriveからCSVを読み込んで2次元配列で返す
 * @private
 */
function loadCsvFromDrive_(fileId) {
  const file = DriveApp.getFileById(fileId);
  const content = file.getBlob().getDataAsString('UTF-8');
  return Utilities.parseCsv(content);
}

/**
 * ヘッダー行から列インデックスを構築する（表記ゆれに対応）
 * @param {string[]} headers - 実際のヘッダー配列
 * @param {Object} mapping - 標準名 → 候補名[] のマッピング
 * @returns {Object} 標準名 → 列インデックス のオブジェクト
 * @private
 */
function buildColumnIndex_(headers, mapping) {
  const result = {};
  const normalizedHeaders = headers.map(h => h.trim().toLowerCase());

  for (const [standardKey, candidates] of Object.entries(mapping)) {
    let found = -1;
    for (const candidate of candidates) {
      const idx = normalizedHeaders.indexOf(candidate.toLowerCase());
      if (idx !== -1) {
        found = idx;
        break;
      }
    }
    result[standardKey] = found; // -1 は「列が見つからなかった」を意味する
  }
  return result;
}

/**
 * 必須列が全て見つかっているか検証する
 * @private
 */
function validateRequiredColumns_(colIdx, requiredKeys, reportType) {
  const missing = requiredKeys.filter(key => colIdx[key] === -1);
  if (missing.length > 0) {
    throw new Error(
      `${reportType}レポートの必須列が見つかりません: ${missing.join(', ')}\n` +
      'ファイルの形式やヘッダー名を確認してください。'
    );
  }
}

/**
 * 安全にセル値を取得する（インデックスが -1 なら空文字を返す）
 * @private
 */
function getCell_(row, colIdx) {
  if (colIdx === undefined || colIdx === -1 || colIdx >= row.length) return '';
  return (row[colIdx] || '').toString().trim();
}

/**
 * 文字列を数値に変換する（カンマ・円記号・%記号を除去）
 * @private
 */
function toNum_(str) {
  if (str === '' || str === null || str === undefined) return 0;
  const cleaned = str.toString().replace(/[,¥$%\s]/g, '');
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

/**
 * シートを取得または作成する
 * @private
 */
function getOrCreateSheet_(ss, sheetName) {
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
  }
  return sheet;
}

/**
 * 売上シートの書式を整える
 * @private
 */
function formatSalesSheet_(sheet, dataRows) {
  if (dataRows === 0) return;
  // 数値列を通貨形式にフォーマット
  const currencyCols = [9, 11, 12, 13, 14, 15, 17]; // 売上高, 手数料, FBA料金, 原価, 広告費, 返品額
  currencyCols.forEach(col => {
    sheet.getRange(2, col, dataRows, 1).setNumberFormat('¥#,##0');
  });
  // 手数料率列
  sheet.getRange(2, 10, dataRows, 1).setNumberFormat('0.0"%"');
  // 交互行背景色
  for (let r = 2; r <= dataRows + 1; r += 2) {
    sheet.getRange(r, 1, 1, 17).setBackground('#f8f9fa');
  }
  // 枠線
  sheet.getRange(1, 1, dataRows + 1, 17)
    .setBorder(true, true, true, true, true, true, '#dadce0', SpreadsheetApp.BorderStyle.SOLID);
}

/**
 * Google Drive ファイルピッカー（簡易版: ファイルIDを直接入力するダイアログ）
 * 本番実装ではPickerAPIを使うが、デモ用にシンプル化
 * @private
 */
function showDriveFilePicker_(prompt) {
  const ui = SpreadsheetApp.getUi();
  const response = ui.prompt(
    'ファイルID入力',
    `${prompt}\nGoogle DriveのファイルURLに含まれるID（/d/XXXXX/の部分）を入力してください。`,
    ui.ButtonSet.OK_CANCEL
  );
  if (response.getSelectedButton() === ui.Button.CANCEL) return null;
  const input = response.getResponseText().trim();

  // URLからIDを抽出（URL貼り付けにも対応）
  const match = input.match(/\/d\/([a-zA-Z0-9_-]+)/);
  return match ? match[1] : input;
}
