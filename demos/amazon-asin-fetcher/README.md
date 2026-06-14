# Amazon ASIN 商品情報取得ツール

ASINリストを渡すと Amazon の商品情報（商品名・価格・画像URL・バリエーション・重量など）を取得し、
Googleスプレッドシートまたは CSV/Excel に一覧化するツールです。

---

## ファイル構成

| ファイル | 説明 |
|---|---|
| `index.html` | デモUI（ブラウザで動作確認、ダミーデータ） |
| `AsinFetcher.gs` | GAS版スクリプト（Googleスプレッドシート対応） |
| `asin_fetcher.py` | Python版スクリプト（CSV / Excel 出力） |

---

## PA-API（正規の商品情報API）について

このツールは **Amazon Product Advertising API v5（PA-API）** を使用します。

- Amazon 公式が提供する商品情報取得 API（無断スクレイピングではありません）
- Amazon アソシエイトアカウント（無料登録可）があれば API キーを取得できます
- 規約に沿った利用のため、セラーアカウントへの影響はありません

---

## Mac 対応

| 方式 | 動作環境 | 備考 |
|---|---|---|
| **GAS版（主案）** | ブラウザ上で動作 → Mac/Windows 問わず動作 | インストール不要 |
| **Python版（補助）** | Mac: `python3`、Windows: `python` | `pip install requests openpyxl` のみ必要 |

---

## GAS版の使い方

1. Googleスプレッドシートを新規作成
2. ツール > Apps Script を開き、`AsinFetcher.gs` の内容を貼り付けて保存
3. スクリプトプロパティ（設定 > スクリプトプロパティ）に以下を設定：
   - `PA_ACCESS_KEY` : PA-API アクセスキー
   - `PA_SECRET_KEY` : PA-API シークレットキー
   - `PA_PARTNER_TAG` : アソシエイトタグ（例: `yourname-22`）
4. 「入力」シートのA列（2行目以降）にASINを入力
5. メニュー「📦 Amazon取得」→「商品情報を取得」を実行

---

## Python版の使い方

```bash
# 依存ライブラリのインストール（初回のみ）
pip3 install requests openpyxl       # Mac
pip install requests openpyxl        # Windows

# 環境変数設定（.env ファイルを作成するか、直接設定）
# .env ファイル例:
# PA_ACCESS_KEY=xxxxxxxxxxxxxxxxxxxx
# PA_SECRET_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
# PA_PARTNER_TAG=yourname-22

# 実行（ASINファイルを指定）
python3 asin_fetcher.py asin_list.txt --output result.xlsx   # Mac
python  asin_fetcher.py asin_list.txt --output result.xlsx   # Windows

# ASINファイルのフォーマット（1行1ASIN）
# B001AABBCC
# B002CCDDEE
# B003EEFFGG
```

---

## 取得できる項目（簡易版）

| 項目 | PA-API での取得 |
|---|---|
| 商品名 | ✓ 取得可 |
| 価格 | ✓ 取得可 |
| 画像URL | ✓ 取得可 |
| 商品説明（特徴） | ✓ 取得可 |
| ブランド名 | ✓ 取得可 |
| 在庫状況 | ✓ 取得可 |
| 商品ページURL | ✓ 自動生成 |
| バリエーション（次元名） | △ 次元名のみ（カラー/サイズ等） |
| 重量・サイズ | △ 登録されている場合のみ |
| 販売者情報 | ✕ PA-APIでは非対応 |

---

## 費用・段階提案

| プラン | 費用 | 納期 | 内容 |
|---|---|---|---|
| **シンプル版（推奨）** | 5,000〜8,000円 | 3〜5営業日 | GAS版一式、商品名/価格/画像URL/バリエーション |
| 標準版 | 10,000〜15,000円 | 5〜7営業日 | + 重量/ランキング/エラーリトライ/Python版 |
| 継続改善版 | 別途相談 | — | 定期自動取得・差分通知・競合比較 |

---

## 注意事項

- PA-API は **1秒あたり1リクエスト** の制限があります（自動ウェイト済み）
- API キー・シークレットキーはコードに直書きせず、スクリプトプロパティまたは `.env` ファイルで管理してください
- PA-API キーを取得するには Amazon アソシエイトアカウントが必要です（無料）
