import { initializeApp, getApps, getApp } from '@react-native-firebase/app';

// Firebase の初期化は google-services.json / GoogleService-Info.plist が配置されていれば自動で行われる。
// 以下は追加設定が必要な場合のみ使用。

export const app = getApps().length === 0 ? undefined : getApp();

export const REGION = 'asia-northeast1';
