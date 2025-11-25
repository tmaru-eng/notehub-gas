# NoteHub セットアップガイド（詳細）

README は概要版です。ここでは手順と運用の詳細をまとめます。

## 1. 前提と配置

- `scriptId` / `spreadsheetId` は ID でも URL でも指定可（スクリプト側で抽出します）。
- Slack 連携は任意。未設定なら自動でスキップされます。
- 事前に `npm install` と `clasp login` を済ませておきます。

## 2. 設定ファイル

```bash
cp deploy.config.template.json deploy.config.json
# scriptId / spreadsheetId を入力（URL で OK）
# Slack を使うなら slackBotToken / slackChannelIds / slackNotificationChannelIds を設定
# webAppUrl は省略可（通知でカスタムURLを使う動作は未検証）
```

## 3. デプロイ手順

```bash
./scripts/deploy.sh --push            # .clasp.json と config.generated.js を生成し clasp push
./scripts/deploy.sh --push --deploy   # push + deploy（既存 HEAD デプロイを自動検出し上書き）
# 既存デプロイを明示指定
./scripts/deploy.sh --push --deploy --deploy-id <DEPLOYMENT_ID>
# 新しいデプロイ ID を作る場合のみ
./scripts/deploy.sh --push --deploy --new-version
```

- 最新の非HEADデプロイを自動選択して上書きし、HEAD 以外の古いデプロイは自動で削除します（HEAD は read-only で最新とは限らないため、出力される Web App URL を利用してください）。
- デプロイ直後は Web App URL の反映に数分かかることがあります。
- デプロイ後は GAS エディタを開き、ページをリロードして最新コードを読み込ませてください。

## 4. GAS での初期実行とトリガー

- 一度だけ: `f00_initSheets`（旧: `initSheets`/`ensureSheetStructure`）を実行し権限付与＆シート作成。
- 動作確認: `f01_integrationTest`（記事の追加/削除・取得を一通り確認）。
- Slack 手動同期: `f02_syncSlackMessages`（設定が無ければ skip と返します）。
- 定期同期したい場合は `f02_syncSlackMessages` を時間ベーストリガーに設定してください。

### Script Properties で上書きしたい場合
- `SPREADSHEET_ID`, `ARTICLES_SHEET_NAME`, `SLACK_SHEET_NAME`, `DRIVE_IMAGES_FOLDER`
- `SLACK_BOT_TOKEN`, `SLACK_CHANNEL_IDS`（カンマ区切り）

## 5. Web アプリ公開と Google Sites 埋め込み（任意）

- GAS メニュー「デプロイ > 新しいデプロイ > ウェブアプリ」で URL を発行。
- Google Sites に埋め込む場合は「埋め込む > URL」に Web アプリ URL を貼り付け、表示サイズを調整。

## 6. Slack Bot セットアップの目安

1) [api.slack.com/apps](https://api.slack.com/apps) で App を作成し Bot User を有効化。
2) OAuth & Permissions で Bot Token Scopes に `channels:history`, `channels:read`, `chat:write`, `users:read` などを付与。
3) Install App to Workspace で Bot User OAuth Token (`xoxb-...`) を取得。
4) 監視したいチャンネルIDを取得（Slack UI の「Copy channel ID」）。
5) 対象チャンネルに Bot を招待（`/invite @Bot名`）。招待されていないと `not_in_channel` エラーになります。
6) Token と Channel IDs を `deploy.config.json` または Script Properties に設定。

## 7. テスト・ビルド・メモ

- テスト: `npm test -- --watchman=false`（Watchman 権限で失敗する環境向け）。
- ビルド: `npm run build`（`google-app/` に生成）。
- 機微情報: `deploy.config.json`, `.clasp.json`, `google-app/config.generated.js` は git 管理外にしてください。

## License

- MIT License. Provided as-is and without warranty; use at your own risk.

---

## Google Apps Script 認証・デプロイ（補足情報）

このプロジェクトは「利用者自身の Google アカウント／GCP プロジェクトにデプロイ」する前提です。初回実行時に OAuth 承認が必要で、必要に応じて GCP 側で OAuth 同意画面を設定できます。

### 1. スクリプトを自分の Apps Script プロジェクトにセットする
- Google Drive で新規 Apps Script プロジェクトを作成
- GAS のコードエディタに本リポジトリのスクリプトを貼り付け、`appsscript.json` などの設定も再現

### 2. 初回実行で OAuth を許可する
- 右上の「実行」から任意の関数を実行し、表示される同意画面で許可
- 「未確認アプリ」の警告は「詳細」→「移動」で進めて許可

### 3. 必要に応じて GCP 側で OAuth 同意画面を自前設定する
Apps Script は内部的に GCP プロジェクトを使います。以下に該当する場合は自分の GCP で同意画面を用意できます。
- 警告を減らしたい / 自分の GCP プロジェクトで管理したい / Workspace 内部アプリにしたい

手順（必要な場合のみ）:
1. GCP コンソールでプロジェクトを作成（または既存を利用）
2. Apps Script の「プロジェクトの設定」→「GCP プロジェクトを変更」でそのプロジェクト ID を紐付け
3. GCP コンソール → 「API とサービス」→「OAuth 同意画面」
   - ユーザータイプを選択（外部/内部）
   - アプリ名・サポートメール・連絡先を入力して保存
   - 「外部」の場合は自分のアカウントをテストユーザーに追加

### 4. Web アプリとしてデプロイする場合
- 「デプロイ」→「新しいデプロイ」→ 種類「Web アプリ」
- 実行ユーザー: 自分
- アクセス権: 必要に応じて指定
- デプロイ後の URL を利用（Google Sites への埋め込みも可能）

### 補足
- OSS のため Google の審査は通していませんが、利用者自身のアカウント・GCP プロジェクト内で完結するモデルです。
- 強めのスコープが含まれても、このモデルではユーザー自身の承認範囲で動作します。
