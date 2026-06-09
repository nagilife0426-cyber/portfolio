# Threads 自動投稿システム（Claude API 連携）

Claude API（claude-haiku-4-5）で集客向け投稿文を生成し、Threads Graph API で自動投稿する仕組みのデモです。

---

## ファイル構成

```
a2-threads-claude/
├── generator.py        Claude API 呼び出し・品質チェック
├── threads_client.py   Threads Graph API クライアント（ドライランモード付き）
├── scheduler.py        スケジュール管理・時間帯制御
├── main.py             CLI エントリーポイント（承認フロー制御）
├── PROMPT_DESIGN.md    プロンプト設計書・変数定義・コスト試算
├── demo.html           インタラクティブデモ UI（承認フロー・サンプル10件）
├── samples/            生成サンプル10件（JSON）
│   ├── sample_01.json  ~ sample_10.json
└── .logs/              生成ハッシュ・投稿ログ・スケジュールデータ
```

---

## セットアップ

### 必要なもの

- Python 3.10 以上
- `anthropic` パッケージ
- Threads アカウント（Meta 開発者アプリ登録済み）

### インストール

```bash
pip install anthropic
```

### 環境変数の設定

```bash
# .env ファイルを作成（git 管理外）
ANTHROPIC_API_KEY=sk-ant-xxxxxxxx
THREADS_ACCESS_TOKEN=xxxxxxxx   # Threads Graph API アクセストークン
THREADS_USER_ID=xxxxxxxxxx       # Threads ユーザー ID
```

```bash
# Mac/Linux
export ANTHROPIC_API_KEY=sk-ant-...

# Windows
set ANTHROPIC_API_KEY=sk-ant-...
```

---

## 使い方

### デモ UI を開く

```bash
# Mac
open demo.html

# または Python でローカルサーバー起動
python3 -m http.server 8792
# → ブラウザで http://localhost:8792/demo.html を開く
```

### CLI コマンド

#### 投稿文を生成して下書き保存

```bash
python3 main.py generate --theme "副業の始め方" --tone "元気・背中を押す"
```

#### 下書き一覧を表示

```bash
python3 main.py list
python3 main.py list --status pending   # 承認待ちのみ
```

#### 下書きを承認

```bash
python3 main.py approve <ID>   # list コマンドで確認した ID を指定
```

#### 承認済みを投稿（ドライランモード）

```bash
python3 main.py post-approved              # ドライラン（デフォルト）
python3 main.py post-approved --dry-run    # 明示的にドライラン
```

#### 本番投稿（環境変数設定後）

```bash
# --dry-run を外すと Threads への実投稿になる
# 注意: THREADS_ACCESS_TOKEN と THREADS_USER_ID の設定が必要
python3 main.py post-approved
```

#### サンプル10件を生成（API キー不要でモック動作）

```bash
python3 main.py samples
```

#### スケジュール状況を確認

```bash
python3 main.py status
```

---

## 設計のポイント

### 1. 人の最終承認フロー

```
生成（Claude API）
  ↓
品質チェック（文字数・NGワード・重複）
  ↓
下書き保存（pending）
  ↓
人が確認 → python3 main.py approve <ID>
  ↓
承認済み（approved） → 投稿時刻になったら post-approved で実行
```

AIが自動で投稿することはなく、必ず人の承認を経由します。

### 2. 品質ガード（3段階）

| チェック | 内容 |
|---------|------|
| 文字数チェック | 500文字以内（Threads API 上限） |
| NGワードチェック | 景品表示法・特商法リスク表現を除外 |
| 重複チェック | SHA-256 ハッシュで過去生成と照合 |

品質チェック失敗時は自動リトライ（最大2回）。

### 3. 投稿ルール制御

- 投稿可能時間帯: JST 7〜22時
- 1日最大投稿数: 3件
- 投稿間隔: 最低4時間

### 4. セキュリティ

- API キーは環境変数のみ（ハードコード禁止）
- デフォルトはドライランモード（実API呼び出しなし）
- ログはローカルファイルのみ（外部送信なし）

---

## コスト試算

| 項目 | 数値 |
|------|------|
| モデル | claude-haiku-4-5 |
| 入力トークン単価 | $1.00 / 1M tokens |
| 出力トークン単価 | $5.00 / 1M tokens |
| 1投稿あたり（約300→200 tokens） | 約 $0.0003（約0.04円） |
| 月30投稿（1日1本） | 約 $0.009（約1.3円） |
| 月90投稿（1日3本） | 約 $0.027（約4円） |

claude-haiku-4-5 はAnthropicの最軽量・最安モデルのため、実質ほぼゼロコストで運用可能。

---

## 継続運用の拡張案

1. **cron / launchd 自動実行** - 毎朝8時に generate + post-approved を自動実行
2. **Slack 通知** - 生成完了時に Slack で承認リクエストを通知
3. **画像付き投稿** - 画像生成 API（DALL-E 等）と連携して image_url を自動設定
4. **業種別テンプレート** - 美容・飲食・コーチング等のプリセット設定ファイル
5. **エンゲージメント追跡** - Threads インサイト API でいいね数を取得して高評価パターンを学習

---

## Threads Graph API について

### アクセストークン取得手順

1. Meta for Developers でアプリを作成
2. Threads API の権限を追加（`threads_basic`, `threads_content_publish`）
3. ユーザートークンを発行（有効期限: 60日間、長期トークンに交換推奨）

### 投稿フロー（2ステップ）

```
POST /v1.0/{user-id}/threads     → container_id 取得
  ↓（2秒待機）
POST /v1.0/{user-id}/threads_publish  → 投稿完了
```

---

## ライセンス・注意事項

- このデモはローカル動作のみを想定しています
- 実際の Threads 投稿前に Meta の利用規約を確認してください
- 過度な自動投稿はアカウント制限のリスクがあります（1日3件以内を推奨）
