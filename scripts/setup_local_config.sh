#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
FIREBASE_APP_DIR="$ROOT_DIR/firebase-app"
CONFIG_FILE="$FIREBASE_APP_DIR/public/firebase-config.js"
FIREBASERC_FILE="$FIREBASE_APP_DIR/.firebaserc"

read -rp "Firebase Project ID: " PROJECT_ID
read -rp "Firebase Web API Key: " API_KEY
read -rp "Firebase App ID: " APP_ID
read -rp "Firebase Sender ID: " SENDER_ID

cat > "$FIREBASERC_FILE" <<EOF
{
  "projects": {
    "default": "$PROJECT_ID"
  }
}
EOF

cat > "$CONFIG_FILE" <<EOF
window.__FIREBASE_CONFIG__ = {
  apiKey: "$API_KEY",
  authDomain: "$PROJECT_ID.firebaseapp.com",
  projectId: "$PROJECT_ID",
  storageBucket: "$PROJECT_ID.appspot.com",
  messagingSenderId: "$SENDER_ID",
  appId: "$APP_ID",
};
EOF

echo "[OK] wrote $FIREBASERC_FILE"
echo "[OK] wrote $CONFIG_FILE"
echo "[INFO] next: ./scripts/preflight_check.py"
