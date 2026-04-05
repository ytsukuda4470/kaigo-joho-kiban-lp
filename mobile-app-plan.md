# 介護情報基盤LP 管理システム モバイルアプリ 設計方針

作成日: 2026-04-04

---

## 1. フレームワーク選定

### 結論: **React Native (Expo)**

| 観点 | React Native (Expo) | Flutter | PWA | Ionic |
|------|--------------------|---------|----|-------|
| Firebase との相性 | ◎ `@react-native-firebase` が成熟 | ○ FlutterFire で対応可 | ○ Web SDK そのまま使用可 | ○ AngularFire / Capacitor 経由 |
| 一人開発コスト | ◎ JS/TS の知識で対応可 | △ Dart を習得する必要あり | ◎ 追加学習ほぼ不要 | ○ Web 技術ベース |
| カメラ・写真撮影 | ◎ `expo-camera` / `expo-image-picker` で容易 | ◎ `image_picker` で容易 | △ ブラウザ制限あり・iOS Safari で挙動不安定 | ○ Capacitor Camera Plugin |
| iOS/Android 両対応 | ◎ | ◎ | △ PWA は iOS で Push/Camera に制限あり | ◎ |
| オフライン対応 | ◎ Firestore offline persistence 利用可 | ◎ | △ Service Worker の制御が複雑 | ○ |

### 選定理由

- 既存の管理サイトが Alpine.js（JavaScript）で構築されており、同じ JS/TS エコシステムで開発できる。
- Expo を使うと iOS/Android のビルド環境を整えなくてもクラウドビルド（EAS Build）が可能で、一人開発の負担が小さい。
- `@react-native-firebase` は Firestore offline persistence・Storage・Auth すべてネイティブ SDK を直接呼び出すため、Web SDK より安定しており、オフライン時の書き込みキューも確実に動作する。
- PWA は iOS Safari のカメラ API・バックグラウンド同期の制限から、現地作業記録用途には不向き。

---

## 2. 推奨アーキテクチャ

### 使用する Firebase サービス

| サービス | 用途 | 備考 |
|---------|------|------|
| Firebase Auth | Google SSO でサインイン | 既存と同じプロジェクト・同じアカウント |
| Firestore | inquiries / actions / followups / templates の読み書き | offline persistence を有効化 |
| Firebase Storage | 現地訪問写真の保存 | 新規有効化が必要（後述） |
| Firebase Functions | sendEmail / notifyGoogleChat の呼び出し | 既存 Functions をそのまま利用 |

### Firestore offline persistence 設定

```typescript
// firebase.ts
import firestore from '@react-native-firebase/firestore';

firestore().settings({
  persistence: true,      // オフライン書き込みキューを有効化
  cacheSizeBytes: firestore.CACHE_SIZE_UNLIMITED,
});
```

これにより、電波のない訪問先での対応記録入力・フォロー完了操作がローカルに保存され、オンライン復帰時に自動同期される。

### 写真の保存設計

#### 保存先パス（命名規則）

```
gs://<project-id>.appspot.com/
  inquiry-photos/
    {inquiryId}/
      {YYYYMMDD_HHmmss}_{uid_6chars}.jpg
```

例: `inquiry-photos/abc123/20260404_143022_u7f3a9.jpg`

- `inquiryId` をディレクトリに使うことで、問い合わせ単位でまとめて表示・削除が可能。
- ファイル名に日時と UID 短縮形を含めることで衝突を回避。
- 拡張子は `.jpg` に統一し、アップロード前に `expo-image-manipulator` で圧縮（最大長辺 1280px、JPEG 品質 80%）。

#### Firestore への参照保存

`actions` コレクションのドキュメントに `photoUrls` フィールドを追加:

```
actions/{actionId}
  inquiryId: string
  text: string
  photoUrls: string[]   // Storage の gs:// パス or download URL
  createdAt: Timestamp
  createdBy: string     // uid
```

#### Firebase Storage セキュリティルール（案）

```
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /inquiry-photos/{inquiryId}/{fileName} {
      // 認証済みユーザーのみ読み書き可
      allow read, write: if request.auth != null;
      // 書き込みサイズ上限: 10MB
      allow write: if request.resource.size < 10 * 1024 * 1024
                   && request.resource.contentType.matches('image/.*');
    }
  }
}
```

本番運用時は `request.auth.token.email` を `@279279.net` ドメインに限定することを推奨:

```
allow read, write: if request.auth != null
                   && request.auth.token.email.matches('.*@279279\\.net');
```

---

## 3. 画面構成

### 画面一覧

```
App
├── (認証)
│   └── LoginScreen          -- Google SSO ログイン
│
├── (タブナビゲーション)
│   ├── [1] InquiryListScreen     -- 問い合わせ一覧
│   ├── [2] FollowupListScreen    -- フォローアップ一覧
│   └── [3] SettingsScreen        -- 設定・ログアウト
│
├── (スタックナビゲーション)
│   ├── InquiryDetailScreen       -- 問い合わせ詳細
│   │   ├── ActionListSection         -- 対応記録一覧（写真サムネイル含む）
│   │   └── FollowupListSection       -- フォロー状況
│   │
│   ├── ActionCreateScreen        -- 対応記録 入力
│   │   ├── テキスト入力欄
│   │   ├── 写真撮影 / ライブラリ選択
│   │   └── 保存ボタン（オフライン時はキュー）
│   │
│   └── PhotoViewerScreen         -- 写真フルスクリーン表示
```

### 各画面の主要要素

#### InquiryListScreen
- 検索バー（名前・会社名）
- ステータスフィルター（未対応 / 対応中 / 完了）
- 問い合わせカード（名前、会社名、最終対応日、未読フォロー数バッジ）
- 右上: 更新アイコン（手動再フェッチ）

#### InquiryDetailScreen
- ヘッダー: 名前、会社名、ステータス
- 連絡先タップで電話 / メールアプリ起動
- 対応記録タイムライン（テキスト＋写真サムネイル）
- FAB（＋）: ActionCreateScreen へ遷移
- フォローアップ一覧: 期日・完了チェックボックス

#### ActionCreateScreen
- テキストエリア（対応内容）
- 写真エリア: カメラ起動ボタン・ライブラリ選択ボタン・プレビューサムネイル（複数枚対応）
- 保存ボタン: Firestore + Storage へ書き込み（オフライン時はローカルキュー）

#### FollowupListScreen
- 期日順ソート
- 完了チェックボックス: タップで `followups/{id}.completedAt` を更新
- 完了済み / 未完了 タブ切り替え

---

## 4. 実装ステップ（フェーズ分け）

### Phase 1 — 基盤構築（約 1 週間）

1. Expo プロジェクト作成
   ```bash
   npx create-expo-app kaigo-mobile --template blank-typescript
   ```
2. Firebase プロジェクトへ iOS / Android アプリを追加し、`google-services.json` / `GoogleService-Info.plist` を配置
3. `@react-native-firebase/app`, `auth`, `firestore`, `storage` をインストール
4. Google Sign-In 設定（`expo-auth-session` + Firebase Auth）
5. React Navigation セットアップ（タブ + スタック）
6. Firestore offline persistence 有効化

### Phase 2 — コア機能実装（約 2 週間）

1. InquiryListScreen: Firestore `inquiries` コレクション購読
2. InquiryDetailScreen: 問い合わせ詳細 + actions / followups サブ表示
3. ActionCreateScreen: テキスト入力 → `actions` コレクションへ書き込み
4. FollowupListScreen: フォローアップ一覧 + 完了マーク

### Phase 3 — 写真機能（約 1 週間）

1. `expo-camera` または `expo-image-picker` をインストール
2. 撮影 → `expo-image-manipulator` でリサイズ・圧縮
3. Firebase Storage へアップロード（進捗表示付き）
4. ダウンロード URL を `actions.photoUrls` に保存
5. PhotoViewerScreen 実装

### Phase 4 — オフライン対応・品質向上（約 1 週間）

1. オフライン時のアップロードキュー実装（`react-native-queue` または Custom Hook）
   - Storage アップロードはオンライン復帰まで保留
   - Firestore 書き込みは SDK の自動キューで対応済み
2. ネットワーク状態バナー表示（`@react-native-community/netinfo`）
3. エラーハンドリング・ローディングスケルトン整備
4. EAS Build で TestFlight / Google Play 内部テスト配布

### Phase 5 — 本番リリース（約 3 日）

1. Storage セキュリティルール本番適用（ドメイン制限）
2. Firestore セキュリティルールにモバイルアプリ向けルール追加（既存ルールを壊さない形で）
3. App Store / Google Play 申請または社内配布

---

## 5. 必要な追加設定

### Firebase Storage の有効化

Firebase Console > Storage > 「始める」から有効化。
リージョンは既存 Functions と同じ **asia-northeast1** を選択。

### Firebase Console でのアプリ追加

1. Firebase Console > プロジェクトの設定 > 「アプリを追加」
2. iOS: Bundle ID を設定（例: `net.279279.kaigo.mobile`）、`GoogleService-Info.plist` をダウンロード
3. Android: パッケージ名を設定（例: `net.n279279.kaigo.mobile`）、`google-services.json` をダウンロード

### Firestore セキュリティルールへの追記

既存の Web アプリ向けルールを維持しつつ、モバイルアプリからの書き込みも許可する。
認証チェック（`request.auth != null`）は共通のため、基本的にルール変更は不要。
ただし現行ルールが `request.auth.token.email` でドメイン制限している場合は、同一ドメインの Google アカウントを使う限り追加変更は不要。

### 既存 Cloud Functions の利用

モバイルアプリから `sendEmail` / `notifyGoogleChat` を呼び出す場合は `@react-native-firebase/functions` を使用:

```typescript
import functions from '@react-native-firebase/functions';

const sendEmail = functions().httpsCallable('sendEmail');
await sendEmail({ to: '...', subject: '...', body: '...' });
```

リージョンが `asia-northeast1` であるため、初期化時に指定が必要:

```typescript
import functions from '@react-native-firebase/functions';
const fn = functions('asia-northeast1');
```

### 依存パッケージ一覧（主要）

```json
{
  "@react-native-firebase/app": "^21.x",
  "@react-native-firebase/auth": "^21.x",
  "@react-native-firebase/firestore": "^21.x",
  "@react-native-firebase/storage": "^21.x",
  "@react-native-firebase/functions": "^21.x",
  "@react-navigation/native": "^6.x",
  "@react-navigation/bottom-tabs": "^6.x",
  "@react-navigation/native-stack": "^6.x",
  "expo-image-picker": "^15.x",
  "expo-image-manipulator": "^12.x",
  "expo-camera": "^15.x",
  "@react-native-community/netinfo": "^11.x"
}
```

---

## 補足: PWA 案を採用しない理由の詳細

現在の管理サイト (`kaigo-kiban-pm.web.app`) を PWA 化する方法も検討したが、以下の理由から React Native (Expo) を推奨する。

- **iOS Safari のカメラ制限**: `getUserMedia` は動作するが、写真をファイルとして扱う `input[type=file]` の挙動が Safari バージョンで異なり不安定。
- **バックグラウンド同期**: iOS は Service Worker のバックグラウンド同期を制限しており、オフライン時に撮影した写真のアップロードが確実に実行されない。
- **ホーム画面追加の UX**: iOS では毎回 Safari の「ホーム画面に追加」を案内する必要があり、社内ツールとしての使い勝手が下がる。
- **Push 通知**: iOS 16.4 以降でようやく PWA Push が対応したが、Safari での挙動は不安定な報告が多い。

一方、Expo を使えば Web 向けビルド (`expo build:web`) も可能なため、将来的に Web でも同一コードを活用できる選択肢が残る。
