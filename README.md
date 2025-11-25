# NoteHub for Google Apps Script

Google スプレッドシートをデータストアにしたシンプルなナレッジ共有 Web アプリです。記事と Slack メッセージを1画面で閲覧できます。

- フロント: GAS HTML Service (`index.html`)
- バックエンド: GAS + スプレッドシート
- 任意: Slack Bot 連携（複数チャンネル対応）
- デプロイ: `clasp` + `scripts/deploy.sh`（設定は `deploy.config.json`）

## クイックスタート（概要）

1) 設定: `cp deploy.config.template.json deploy.config.json` を作り、`scriptId`/`spreadsheetId` を URL または ID で入力（Slack は任意、webAppUrl は省略可）。
2) セットアップ: `npm install` → `clasp login`。
3) デプロイ: `./scripts/deploy.sh --push`（必要なら `--deploy` 追加）。反映に数分かかる場合あり。デプロイ後は GAS エディタをリロード。
   - deploy スクリプトは最新デプロイIDを自動選択して上書きし、HEAD と最新以外は自動削除します（HEAD は read-only で更新されません）。
4) 初期化: GAS エディタで `f00_initSheets` を1回実行（権限付与）。動作確認は `f01_integrationTest`。
5) Slack同期: 手動 `f02_syncSlackMessages`。定期実行したい場合はこの関数を時間ベーストリガーに設定。
6) 詳細手順・トラブルシュートは `docs/guide.md` 参照。

## GAS 実行用関数（主にエディタから）

- `f00_initSheets`: 初期セットアップ（シート作成）。
- `f01_integrationTest`: 動作確認（記事の追加/削除・取得）。
- `f02_syncSlackMessages`: Slack 同期（Slack 設定が無い場合は skip）。トリガー設定用にも利用。
  - Slack 通知時に `webAppUrl` を使う動作は未検証です。空のままで利用するのがおすすめです。

## コマンドとメモ

- デプロイ: `./scripts/deploy.sh --push`（必要なら `--deploy`/`--deploy-id`/`--new-version`）。URL のまま `scriptId`/`spreadsheetId` を入れても ID に自動抽出。
  - 最新の非HEADを自動選択して上書きし、HEAD 以外の古いデプロイは自動で削除します。HEAD は read-only で最新とは限らないため、出力される Web App URL（最新デプロイID）を使ってください。
- テスト: `npm test -- --watchman=false`（Watchman 権限で落ちる環境向け）。
- ビルド: `npm run build`（`google-app/` に生成）。
- 機微情報: `deploy.config.json`, `.clasp.json`, `google-app/config.generated.js` は git 管理外にしてください。

## License

- MIT License. Provided as-is and without warranty; use at your own risk.

## ファイル構成（必要/生成/除外）

- `src/`
  - `main.ts`: GAS 本体
  - `config.ts`: グローバル設定読み込み（GAS 実行用）
  - `config.module.ts`: テスト用のモジュール版 `getConfig`
  - `types.d.ts`: GAS グローバル向け型定義
  - `types.module.ts`: テスト用（`ScriptProperties` のみ）
- `google-app/`（`npm run build` 出力）
  - `appsscript.json`
  - `config.js`（ビルド生成）
  - `config.generated.js`（`scripts/deploy.sh` が生成。機微情報を含むため git には含めない）
  - `index.html`, `main.js`, `styles.html`
- その他
  - `scripts/deploy.sh`
  - `deploy.config.template.json`（実値は `deploy.config.json` を作成して使用）
  - `tests/config.test.ts`
  - `README.md`, `docs/guide.md`

### git に含めない想定

- `deploy.config.json`, `.clasp.json`, `google-app/config.generated.js`（機微情報）
- `node_modules/`, `tmp-jest/`, `.gemini/`, `.DS_Store`（生成物・ノイズ）

詳細な認証フローや Web アプリへのデプロイ手順は `docs/guide.md` の「Google Apps Script 認証・デプロイ（オプション）」を参照してください。
