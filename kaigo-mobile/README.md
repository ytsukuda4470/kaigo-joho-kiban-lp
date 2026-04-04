# kaigo-mobile

介護情報基盤 管理アプリ (React Native / Expo)

## セットアップ

### 1. Firebase アプリを追加

Firebase Console > プロジェクトの設定 > アプリを追加

- iOS: Bundle ID `net.279279.kaigo.mobile` → `GoogleService-Info.plist` を `kaigo-mobile/` に配置
- Android: パッケージ名 `net.n279279.kaigo.mobile` → `google-services.json` を `kaigo-mobile/android/app/` に配置

### 2. Google Sign-In の設定

`src/screens/LoginScreen.tsx` の `webClientId` を Firebase Console の OAuth クライアント ID に設定。

```bash
npm install @react-native-google-signin/google-signin
```

### 3. 依存パッケージのインストール

```bash
npm install
```

### 4. 開発実行

```bash
npx expo start
```

iOS/Android シミュレータ、または Expo Go アプリで動作確認。

### 5. 本番ビルド (EAS Build)

```bash
npm install -g eas-cli
eas login
eas build --platform ios   # TestFlight 配布
eas build --platform android  # Google Play 内部テスト
```

## 画面構成

- **問い合わせ一覧** — 検索・ステータスフィルター付き
- **問い合わせ詳細** — 連絡先タップで電話/メール、対応履歴タイムライン、フォローアップ
- **対応記録追加** — テキスト + 写真撮影/ライブラリ選択 (Firebase Storage アップロード)
- **フォローアップ一覧** — 期日順、期限切れバッジ、完了マーク
- **設定** — ユーザー情報・ログアウト

## Firebase Storage セキュリティルール

```
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /inquiry-photos/{inquiryId}/{fileName} {
      allow read, write: if request.auth != null
                         && request.auth.token.email.matches('.*@279279\\.net');
    }
  }
}
```
