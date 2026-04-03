# 介護情報基盤 CRM — デプロイ手順

## 1. Google Apps Script プロジェクト作成

1. https://script.google.com にアクセス
2. 「新しいプロジェクト」をクリック
3. プロジェクト名を「介護情報基盤 CRM」に変更

## 2. ファイルのコピー

### Code.gs
- デフォルトの `コード.gs` の中身を `Code.gs` の内容に丸ごと置き換え

### Index.html
- 「+」→「HTML」→ファイル名を `Index` に設定（拡張子なし）
- `Index.html` の内容を貼り付け

## 3. スクリプトプロパティの設定

「プロジェクトの設定」→「スクリプト プロパティ」

| プロパティ名 | 値 |
|---|---|
| `SPREADSHEET_ID` | 問い合わせデータのスプレッドシートID（URLの /d/ 〜 /edit の間の文字列） |

## 4. ウェブアプリとしてデプロイ

1. 右上「デプロイ」→「新しいデプロイ」
2. 種類: **ウェブアプリ**
3. 設定:
   - 次のユーザーとして実行: **ウェブアプリにアクセスしているユーザー**（SSO有効）
   - アクセスできるユーザー: **自分のドメインのユーザー全員**（Workspaceの場合）
4. 「デプロイ」→ウェブアプリURLをコピー

## 5. 初期設定

1. ウェブアプリURLをブラウザで開く（Google SSOで自動ログイン）
2. 右上「初期設定」ボタンをクリック
   - 問い合わせシートに追加列（対応状況・担当者・メモ等）を自動追加
   - 対応履歴・フォローアップ・メールテンプレートシートを自動作成

## 5.1 LP問い合わせ受信（doPost）

このリポジトリの `Code.gs` には、公開LPからの送信用 `doPost` が実装済みです。

- 受信フィールド: メールアドレス、法人名、事業所名、住所、担当者、問い合わせ内容など
- 保存先: `問い合わせ` シート
- 既存シートに不足列があれば自動補完

公開LPの `GAS_URL` が、このデプロイURLと一致しているかを必ず確認してください。

## 6. GitHub Token 設定（LP 管理機能に必要）

「LP 管理」ページから記事の編集・公開・自動収集トリガーを使うには GitHub PAT が必要です。

1. https://github.com/settings/tokens/new にアクセス
2. スコープ: `repo` ✅ と `workflow` ✅ にチェック
3. 生成したトークンを GAS スクリプトプロパティに登録:

| プロパティ名 | 値 |
|---|---|
| `GITHUB_TOKEN` | `ghp_xxxxxx...` |

## 7. Google Chat Webhook 設定

GASスクリプト内の既存Webhookはそのまま使用。
新規通知はCRMアプリのメール送信機能から直接送信できます。

## clasp を使った CLI デプロイ（上級者向け）

```bash
npm install -g @google/clasp
clasp login
clasp create --type webapp --title "介護情報基盤 CRM"
# .clasp.json が生成される
clasp push
clasp deploy
```

## 本番前チェック（推奨）

リポジトリルートで次を実行し、`[NG]` がゼロになることを確認します。

```bash
./scripts/preflight_check.py
```

Firebase のローカル設定ファイル作成は次で半自動化できます。

```bash
./scripts/setup_local_config.sh
```

入力値（Project ID / API Key / App ID / Sender ID）を聞かれるので、Firebase Console の値を貼り付けてください。

現在の主な `[NG]` は、以下の未設定値です。

- `firebase-app/.firebaserc` の `YOUR_FIREBASE_PROJECT_ID`
- `firebase-app/public/index.html` の Firebase Config 値
- `gas-app/Code.gs` 内コメント例の `YOUR_SHEET_ID`（実運用ではスクリプトプロパティ側に設定）
