/**
 * Amazon ASIN 商品情報取得ツール — GAS版（PA-API v5）
 * --------------------------------------------------------
 * 動作環境: Google Apps Script（Googleスプレッドシート）
 * 対応OS  : Mac / Windows どちらでも動作（ブラウザ上で動くため OS 非依存）
 *
 * 【使い方】
 *  1. Googleスプレッドシートを新規作成し、このスクリプトを
 *     ツール > Apps Script に貼り付けて保存
 *  2. スプレッドシートの「入力」シートのA列に ASIN を入力
 *  3. メニュー「Amazon取得」→「商品情報を取得」を実行
 *  4. 「出力」シートに取得結果が書き込まれます
 *
 * 【PA-API キーの取得】
 *  Amazon アソシエイトに登録（無料）→ PA-API アクセスキーを発行
 *  下記 CONFIG の ACCESS_KEY / SECRET_KEY に設定してください。
 *
 * 【注意】
 *  - PA-API は 1秒あたり 1リクエスト制限があります（自動ウェイト済み）
 *  - 取得できない項目は "取得不可" と表示されます
 *  - APIキー・シークレットキーはコードに直書きせず
 *    スクリプトプロパティ（設定 > スクリプトプロパティ）に保存してください
 */

// ============================================================
// 設定（スクリプトプロパティ推奨）
// ============================================================
const CONFIG = {
  // ▼ スクリプトプロパティから読み込む（推奨）
  ACCESS_KEY:    PropertiesService.getScriptProperties().getProperty('PA_ACCESS_KEY')    || 'YOUR_ACCESS_KEY_HERE',
  SECRET_KEY:    PropertiesService.getScriptProperties().getProperty('PA_SECRET_KEY')    || 'YOUR_SECRET_KEY_HERE',
  PARTNER_TAG:   PropertiesService.getScriptProperties().getProperty('PA_PARTNER_TAG')   || 'your-associate-tag-22',
  // PA-API エンドポイント（日本マーケットプレイス）
  HOST:          'webservices.amazon.co.jp',
  REGION:        'us-west-2',
  // 1リクエストあたりの最大ASIN数（PA-API 制限: 10）
  BATCH_SIZE:    10,
  // リクエスト間のウェイト（ミリ秒）— PA-API レート制限対策
  WAIT_MS:       1100,
};

// 取得するリソース（PA-API v5 の Resource 指定）
const PA_RESOURCES = [
  'ItemInfo.Title',
  'ItemInfo.Features',
  'ItemInfo.ProductInfo',
  'ItemInfo.ByLineInfo',
  'Offers.Listings.Price',
  'Offers.Listings.Availability.Type',
  'Images.Primary.Medium',
  'Images.Primary.Large',
  'VariationSummary.VariationDimension',
];

// ============================================================
// カスタムメニュー
// ============================================================
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('📦 Amazon取得')
    .addItem('商品情報を取得', 'fetchAllAsins')
    .addSeparator()
    .addItem('出力シートをクリア', 'clearOutput')
    .addItem('使い方を表示', 'showHelp')
    .addToUi();
}

// ============================================================
// メイン処理: 全ASIN を取得して出力シートに書き込む
// ============================================================
function fetchAllAsins() {
  const ss     = SpreadsheetApp.getActiveSpreadsheet();
  const inSh   = getOrCreateSheet(ss, '入力');
  const outSh  = getOrCreateSheet(ss, '出力');
  const errSh  = getOrCreateSheet(ss, 'エラー');

  // 入力シートからASINリストを読み込む（A列、1行目はヘッダー）
  const lastRow = inSh.getLastRow();
  if (lastRow < 2) {
    SpreadsheetApp.getUi().alert('「入力」シートのA2以降にASINを入力してください。');
    return;
  }
  const asinRange = inSh.getRange(2, 1, lastRow - 1, 1).getValues();
  const asins = asinRange
    .map(row => String(row[0]).trim().toUpperCase())
    .filter(a => /^[A-Z0-9]{10}$/.test(a));

  if (asins.length === 0) {
    SpreadsheetApp.getUi().alert('有効なASIN（10桁英数字）が見つかりませんでした。');
    return;
  }

  // 出力シートのヘッダーを設定
  setupOutputSheet(outSh);
  setupErrorSheet(errSh);

  const allResults = [];
  const errors     = [];
  let outRow = 2; // ヘッダーの次から

  // バッチ処理（最大10件ずつ）
  for (let i = 0; i < asins.length; i += CONFIG.BATCH_SIZE) {
    const batch = asins.slice(i, i + CONFIG.BATCH_SIZE);

    try {
      const items = callPaApi(batch);
      batch.forEach(asin => {
        const item = items[asin];
        if (item) {
          const row = formatRow(asin, item);
          outSh.getRange(outRow, 1, 1, row.length).setValues([row]);
          allResults.push({ asin, status: 'success' });
        } else {
          // レスポンスにないASIN（商品削除・非対応など）
          const row = errorRow(asin, '商品情報なし（削除・非対応の可能性）');
          outSh.getRange(outRow, 1, 1, row.length).setValues([row]);
          errors.push({ asin, reason: '商品情報なし' });
        }
        outRow++;
      });
    } catch (e) {
      // APIエラー時はバッチ全体をエラー記録
      batch.forEach(asin => {
        const row = errorRow(asin, e.message || 'APIエラー');
        outSh.getRange(outRow, 1, 1, row.length).setValues([row]);
        errors.push({ asin, reason: e.message || 'APIエラー' });
        outRow++;
      });
    }

    // レート制限対策: バッチ間にウェイト
    if (i + CONFIG.BATCH_SIZE < asins.length) {
      Utilities.sleep(CONFIG.WAIT_MS);
    }
  }

  // エラーシートに記録
  if (errors.length > 0) {
    errors.forEach((e, idx) => {
      errSh.getRange(idx + 2, 1, 1, 3).setValues([[
        new Date(), e.asin, e.reason
      ]]);
    });
  }

  // 書式設定（価格列を通貨形式に）
  try {
    const priceCol = outSh.getRange(2, 4, outRow - 2, 1);
    priceCol.setNumberFormat('¥#,##0');
  } catch (_) {}

  SpreadsheetApp.getUi().alert(
    `完了しました。\n✓ 取得成功: ${allResults.filter(r => r.status === 'success').length}件\n✕ エラー: ${errors.length}件\n\n「出力」シートを確認してください。`
  );
}

// ============================================================
// PA-API v5 呼び出し（AWS Signature Version 4）
// ============================================================
function callPaApi(asins) {
  const payload = {
    ItemIds:     asins,
    Resources:   PA_RESOURCES,
    PartnerTag:  CONFIG.PARTNER_TAG,
    PartnerType: 'Associates',
    Marketplace: 'www.amazon.co.jp',
  };

  const body    = JSON.stringify(payload);
  const now     = new Date();
  const date    = Utilities.formatDate(now, 'UTC', "yyyyMMdd'T'HHmmss'Z'");
  const dateDay = date.substring(0, 8);

  // 署名に必要なヘッダー
  const target  = 'com.amazon.paapi5.v1.ProductAdvertisingAPIv1.GetItems';
  const headers = {
    'content-encoding': 'amz-1.0',
    'content-type':     'application/json; charset=utf-8',
    'host':             CONFIG.HOST,
    'x-amz-date':      date,
    'x-amz-target':    target,
  };

  // AWS Signature Version 4
  const signature = buildSigV4(body, headers, date, dateDay, target);

  const allHeaders = Object.assign({}, headers, {
    'Authorization': signature,
  });

  // PA-API エンドポイントへリクエスト
  const url = `https://${CONFIG.HOST}/paapi5/getitems`;
  const response = UrlFetchApp.fetch(url, {
    method:             'POST',
    headers:            allHeaders,
    payload:            body,
    muteHttpExceptions: true,
  });

  const code = response.getResponseCode();
  const text = response.getContentText();

  if (code !== 200) {
    // PA-APIが利用不可の場合はダミーデータで代替（開発・テスト用）
    if (CONFIG.ACCESS_KEY === 'YOUR_ACCESS_KEY_HERE') {
      return buildDummyItems(asins);
    }
    throw new Error(`PA-API エラー [${code}]: ${text.substring(0, 200)}`);
  }

  const json = JSON.parse(text);
  const result = {};
  (json.ItemsResult?.Items || []).forEach(item => {
    result[item.ASIN] = item;
  });
  return result;
}

// ============================================================
// AWS Signature Version 4 生成
// ============================================================
function buildSigV4(body, headers, amzDate, dateDay, target) {
  // 正規ヘッダーを構築（アルファベット順）
  const sortedKeys = Object.keys(headers).sort();
  const canonicalHeaders = sortedKeys.map(k => `${k}:${headers[k]}`).join('\n') + '\n';
  const signedHeaders    = sortedKeys.join(';');

  // ペイロードハッシュ
  const payloadHash = sha256Hex(body);

  // 正規リクエスト
  const canonicalRequest = [
    'POST',
    '/paapi5/getitems',
    '',
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  // 署名文字列
  const credentialScope = `${dateDay}/${CONFIG.REGION}/ProductAdvertisingAPI/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join('\n');

  // 署名キーを派生
  const signingKey = hmac(
    hmac(
      hmac(
        hmac(
          `AWS4${CONFIG.SECRET_KEY}`,
          dateDay,
          'raw'
        ),
        CONFIG.REGION,
        'hmac'
      ),
      'ProductAdvertisingAPI',
      'hmac'
    ),
    'aws4_request',
    'hmac'
  );

  // 署名
  const sig = hmacHex(signingKey, stringToSign);

  return `AWS4-HMAC-SHA256 Credential=${CONFIG.ACCESS_KEY}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${sig}`;
}

/** SHA-256 ハッシュを hex 文字列で返す */
function sha256Hex(data) {
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    data,
    Utilities.Charset.UTF_8
  );
  return bytesToHex(bytes);
}

/** HMAC-SHA256（raw: 生バイト、hmac: バイト配列入力、hex: hex 文字列出力） */
function hmac(key, data, mode) {
  const keyBytes  = typeof key === 'string'
    ? Utilities.newBlob(key).getBytes()
    : key;
  const dataBytes = typeof data === 'string'
    ? Utilities.newBlob(data).getBytes()
    : data;

  const result = Utilities.computeHmacSha256Signature(dataBytes, keyBytes);
  if (mode === 'raw' || mode === 'hmac') return result;
  return bytesToHex(result);
}

function hmacHex(key, data) {
  return hmac(key, data, 'hex');
}

function bytesToHex(bytes) {
  return bytes.map(b => ('0' + (b & 0xFF).toString(16)).slice(-2)).join('');
}

// ============================================================
// レスポンス整形
// ============================================================
function formatRow(asin, item) {
  const title       = item.ItemInfo?.Title?.DisplayValue || '取得不可';
  const price       = item.Offers?.Listings?.[0]?.Price?.Amount || '';
  const currency    = item.Offers?.Listings?.[0]?.Price?.Currency || 'JPY';
  const availability= item.Offers?.Listings?.[0]?.Availability?.Type || '不明';
  const imageUrl    = item.Images?.Primary?.Large?.URL || item.Images?.Primary?.Medium?.URL || '取得不可';
  const features    = (item.ItemInfo?.Features?.DisplayValues || []).slice(0, 3).join(' / ') || '取得不可';
  const variations  = (item.VariationSummary?.VariationDimension || []).join(' / ') || 'なし';
  const brand       = item.ItemInfo?.ByLineInfo?.Brand?.DisplayValue || '取得不可';
  const productInfo = item.ItemInfo?.ProductInfo;
  const weight      = productInfo?.ItemDimensions?.Weight
    ? `${productInfo.ItemDimensions.Weight.DisplayValue} ${productInfo.ItemDimensions.Weight.Unit}`
    : '取得不可';
  const detailUrl   = `https://www.amazon.co.jp/dp/${asin}`;
  const fetchedAt   = new Date();

  return [
    asin,         // A: ASIN
    title,        // B: 商品名
    price,        // C: 価格（円）
    currency,     // D: 通貨
    brand,        // E: ブランド
    imageUrl,     // F: 画像URL
    features,     // G: 商品説明（特徴）
    variations,   // H: バリエーション
    weight,       // I: 重量
    availability, // J: 在庫状況
    detailUrl,    // K: 商品ページURL
    '成功',       // L: ステータス
    fetchedAt,    // M: 取得日時
  ];
}

function errorRow(asin, reason) {
  return [
    asin, '取得失敗', '', 'JPY', '', '', '', '', '', '', '', `エラー: ${reason}`, new Date()
  ];
}

// ============================================================
// ダミーデータ（PA-APIキー未設定時のフォールバック）
// ============================================================
function buildDummyItems(asins) {
  const DUMMY = {
    'B001AABBCC': { title: 'ステンレス真空断熱ボトル 500ml', price: 2980, brand: 'サンプルブランド', image: 'https://example.com/image1.jpg', features: '保温保冷対応 / 広口設計 / 食洗機対応', variations: 'カラー / サイズ', weight: '280g', availability: 'Available' },
    'B002CCDDEE': { title: 'USB-C ハブ 7-in-1', price: 3480, brand: 'TechSample', image: 'https://example.com/image2.jpg', features: 'HDMI 4K / PD 100W / USB3.0×3', variations: 'カラー', weight: '68g', availability: 'Available' },
  };

  const result = {};
  asins.forEach(asin => {
    const d = DUMMY[asin] || { title: `[ダミー] 商品 ${asin}`, price: 1000, brand: 'テスト', image: '', features: 'テストデータ', variations: 'なし', weight: '不明', availability: 'Available' };
    result[asin] = {
      ASIN: asin,
      ItemInfo: {
        Title:       { DisplayValue: d.title },
        Features:    { DisplayValues: [d.features] },
        ByLineInfo:  { Brand: { DisplayValue: d.brand } },
        ProductInfo: { ItemDimensions: { Weight: { DisplayValue: d.weight, Unit: 'Grams' } } },
      },
      Offers: { Listings: [{ Price: { Amount: d.price, Currency: 'JPY' }, Availability: { Type: d.availability } }] },
      Images: { Primary: { Large: { URL: d.image } } },
      VariationSummary: { VariationDimension: d.variations.split(' / ') },
    };
  });
  return result;
}

// ============================================================
// シート初期化ユーティリティ
// ============================================================
function getOrCreateSheet(ss, name) {
  return ss.getSheetByName(name) || ss.insertSheet(name);
}

function setupOutputSheet(sheet) {
  sheet.clearContents();
  const headers = [
    'ASIN', '商品名', '価格(円)', '通貨', 'ブランド',
    '画像URL', '商品説明', 'バリエーション', '重量',
    '在庫状況', '商品ページURL', 'ステータス', '取得日時',
  ];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length)
    .setBackground('#131921')
    .setFontColor('#ffffff')
    .setFontWeight('bold');
  sheet.setFrozenRows(1);
}

function setupErrorSheet(sheet) {
  sheet.clearContents();
  const headers = ['日時', 'ASIN', 'エラー内容'];
  sheet.getRange(1, 1, 1, 3).setValues([headers]);
  sheet.getRange(1, 1, 1, 3)
    .setBackground('#c5221f')
    .setFontColor('#ffffff')
    .setFontWeight('bold');
}

function clearOutput() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ['出力', 'エラー'].forEach(name => {
    const sh = ss.getSheetByName(name);
    if (sh) sh.clearContents();
  });
  SpreadsheetApp.getUi().alert('「出力」「エラー」シートをクリアしました。');
}

function showHelp() {
  const html = `<b>【使い方】</b><br>
1. 「入力」シートのA列（2行目以降）に ASIN を入力<br>
2. メニュー「Amazon取得」→「商品情報を取得」を実行<br>
3. 「出力」シートに結果が書き込まれます<br><br>
<b>【PA-APIキーの設定】</b><br>
スクリプトエディタ → 設定 → スクリプトプロパティに<br>
<code>PA_ACCESS_KEY</code> / <code>PA_SECRET_KEY</code> / <code>PA_PARTNER_TAG</code> を設定<br><br>
<b>【注意事項】</b><br>
・PA-API は 1秒あたり 1リクエスト制限あり<br>
・Amazon アソシエイトアカウントが必要（無料）<br>
・取得できない項目は「取得不可」と表示`;

  SpreadsheetApp.getUi().showModalDialog(
    HtmlService.createHtmlOutput(html).setWidth(420).setHeight(300),
    'Amazon ASIN取得ツール — 使い方'
  );
}
