# Instagram・Threads 自動投稿システム（GAS実装）

Instagram 2アカウント＋Threads 2アカウントへ、Googleスプレッドシートで管理したコンテンツを自動配信するシステムです。  
Google Apps Script（GAS）の無料枠のみで動作するため、Buffer/Make のようなランニングコストが不要です。

---

## ファイル構成

```
a1-sns-autopost/
├── Main.gs           # トリガーエントリポイント・次回トリガー再設定
├── Config.gs         # 設定定数・Script Properties 参照
├── SheetRepo.gs      # スプレッドシート読み書き
├── InstagramApi.gs   # Instagram Graph API クライアント
├── ThreadsApi.gs     # Threads API クライアント
├── Poster.gs         # 投稿振り分け・リトライ・ログ記録
├── SHEET_SPEC.md     # スプレッドシート構造定義
├── ARCHITECTURE.md   # 処理フロー・コスト試算・API制限対応
└── demo.html         # 管理画面モック（ブラウザで開いて確認可能）
```

---

## 必要な API と取得手順の要点

### Instagram Graph API

1. [Meta for Developers](https://developers.facebook.com/) でアプリを作成
2. アプリに「Instagram Graph API」製品を追加
3. Instagram ビジネスアカウント（または クリエイターアカウント）を Facebook ページに紐付け
4. `pages_read_engagement` `instagram_basic` `instagram_content_publish` の権限を取得
5. **長期アクセストークン（60日有効）**を発行。定期的な更新が必要（Script Properties に保存）
6. `/{ig-user-id}` エンドポイントでユーザーIDを確認

### Threads API

1. 同じ Meta for Developers のアプリに「Threads API」製品を追加
2. Threads アカウントをアプリに接続
3. `threads_basic` `threads_content_publish` の権限を取得
4. アクセストークン・ユーザーIDを取得（構造は Instagram Graph API と同様）

> **注意**: 両 API とも本番利用には Meta のアプリ審査が必要です。個人利用（自分のアカウントへの投稿）であれば審査不要で利用できます。

---

## Script Properties の設定

GAS エディタの「プロジェクトの設定」>「スクリプトプロパティ」から以下のキーを登録してください。  
ソースコードには一切トークンを記載しない設計です。

| キー名 | 値 | 説明 |
|--------|----|------|
| `SPREADSHEET_ID` | スプレッドシートのID | URLの `/d/XXXXXXX/` 部分 |
| `IG_ACCESS_TOKEN_1` | Instagramアクセストークン1 | 60日有効、定期更新が必要 |
| `IG_USER_ID_1` | Instagram ユーザーID 1 | 数字のID |
| `IG_ACCESS_TOKEN_2` | Instagramアクセストークン2 | アカウント2用 |
| `IG_USER_ID_2` | Instagram ユーザーID 2 | アカウント2用 |
| `TH_ACCESS_TOKEN_1` | Threads アクセストークン1 | アカウント1用 |
| `TH_USER_ID_1` | Threads ユーザーID 1 | アカウント1用 |
| `TH_ACCESS_TOKEN_2` | Threads アクセストークン2 | アカウント2用 |
| `TH_USER_ID_2` | Threads ユーザーID 2 | アカウント2用 |

---

## デプロイ手順

### 1. スプレッドシートの準備

1. 新規スプレッドシートを作成
2. 以下の3シートを作成（シート名は正確に）:
   - `投稿マスタ`
   - `設定`
   - `ログ`
3. 各シートの列・初期データは `SHEET_SPEC.md` の定義に従って入力
4. スプレッドシートのIDをコピーしておく

### 2. GAS プロジェクトの作成

1. スプレッドシートのメニュー「拡張機能」>「Apps Script」を開く
2. デフォルトの `コード.gs` を削除
3. 以下のファイルを順番に作成し、各 `.gs` ファイルの内容をコピーして貼り付け:
   - `Config.gs`
   - `SheetRepo.gs`
   - `InstagramApi.gs`
   - `ThreadsApi.gs`
   - `Poster.gs`
   - `Main.gs`

### 3. Script Properties の登録

1. GAS エディタの「プロジェクトの設定（歯車アイコン）」をクリック
2. 「スクリプトプロパティ」セクションで、上記テーブルのキーと値をすべて追加
3. `runValidation` 関数を実行して設定漏れがないか確認

### 4. 初回トリガーの登録

1. GAS エディタで `setupFirstTrigger` 関数を選択
2. 「実行」ボタンをクリック（初回は権限承認ダイアログが表示される）
3. 権限を承認すると、`triggerPostQueue` の最初のトリガーが自動登録される

### 5. 動作確認

1. `triggerPostQueue` を手動で実行し、投稿マスタの先頭行が `done` になることを確認
2. ログシートに SUCCESS が記録されていることを確認
3. 実際の SNS アカウントにも投稿が反映されていることを確認

---

## 運用方法

### 投稿内容を追加する

スプレッドシートの「投稿マスタ」シートの末尾に行を追加するだけです。

| 追加する列 | 入力内容 |
|-----------|----------|
| A列（投稿ID） | `post_151` のように一意なIDを入力 |
| B列（画像URL） | 公開アクセス可能な画像URL（Google Driveの共有リンク等） |
| C列（本文） | キャプション。Alt+Enter で改行入力可能 |
| D列（状態） | `pending` と入力（GASが自動で更新） |
| E・F列 | 空欄でOK（GASが自動入力） |

> **Google Drive の画像URLについて**: 通常の共有リンク（`drive.google.com/file/d/XXXX/view`）はAPIから直接取得できません。`https://drive.google.com/uc?export=download&id=XXXX` 形式のダウンロードURLに変換して使用してください。

### 投稿間隔を変更する

スプレッドシートの「設定」シートのB列の値を変更するだけです。GASコードの編集は不要です。

### 特定のアカウントを一時停止する

`Config.gs` の `ACCOUNTS` 配列で対象アカウントの `enabled: true` を `enabled: false` に変更してください。

### ループをリセットする（最初から再投稿）

投稿マスタシートのD列（状態）をすべて `pending` に変更してください。または、`SheetRepo.resetAllPostStatus()` 関数を直接実行しても同様の操作ができます。

---

## コスト試算

### GAS 無料枠内で十分な理由

| リソース | 無料上限 | 本システムの推定消費 | 余裕 |
|---------|---------|---------------------|------|
| スクリプト実行時間/日 | 6時間 | 約4〜8分/日 | 約97%余裕 |
| UrlFetch 呼び出し/日 | 20,000回 | 約64〜96回/日 | 約99%余裕 |
| スプレッドシート操作/日 | 無制限 | 数十回/日 | 問題なし |

**月額費用の比較**:
- Buffer（Essentials）: 約1,800円/月
- Make（Basic）: 約1,200円/月
- **本システム（GAS）: 0円/月**（Googleアカウントがあれば追加費用なし）

---

## 制限事項・注意点

1. **アクセストークンの有効期限**: Instagram/Threads のアクセストークンは約60日で期限切れになります。更新を忘れると投稿が止まります。期限前にリマインダーを設定することを推奨します。

2. **Instagram API のレート制限**: 1アカウントあたり1日25投稿まで。30分間隔・15時間稼働では最大30投稿/日になるため、**設定の稼働時間帯を調整**して1アカウント25投稿以内に収めてください（例：稼働時間を12時間に絞ると24投稿/日）。

3. **画像URLの要件**: 画像は外部から公開アクセスできるURLである必要があります。Googleドライブの画像をそのまま使う場合は、共有設定を「リンクを知っている全員」にしたうえで直接ダウンロードURLに変換してください。

4. **GAS の実行時間制限**: 1回の実行は最大6分間です。コンテナのステータス確認でポーリングを繰り返す設計のため、通常は問題ありません。

5. **二重投稿防止**: `LockService` による排他制御を実装していますが、GAS の仕様上、まれに重複実行が発生する可能性があります。ログシートで重複を確認できます。
