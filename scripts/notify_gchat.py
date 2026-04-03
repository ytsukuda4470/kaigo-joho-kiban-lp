#!/usr/bin/env python3
"""
Google Chat webhook に通知を送る
引数: JSON文字列（update_news.py の出力）
環境変数: GCHAT_WEBHOOK_URL
"""

import json
import os
import sys
import urllib.request

def main():
    webhook_url = os.environ.get("GCHAT_WEBHOOK_URL", "").strip()
    if not webhook_url:
        print("[SKIP] GCHAT_WEBHOOK_URL が未設定のため通知をスキップします")
        return

    # stdin または引数から JSON を読む
    if len(sys.argv) > 1:
        raw = sys.argv[1]
    else:
        raw = sys.stdin.read()

    try:
        data = json.loads(raw)
    except json.JSONDecodeError as e:
        print(f"[ERROR] JSON parse error: {e}", file=sys.stderr)
        sys.exit(1)

    fetched_at = data.get("fetched_at", "")
    article_count = data.get("article_count", 0)
    articles = data.get("articles", [])

    # 記事リスト（最大5件）
    lines = []
    for a in articles[:5]:
        title = a["title"][:45] + "…" if len(a["title"]) > 45 else a["title"]
        lines.append(f"• [{a['source']}] {a['date']} — {title}\n  {a['url']}")
    articles_text = "\n".join(lines) if lines else "（記事なし）"

    message = (
        f"*🗞️ 介護情報基盤 LP ニュース自動更新*\n\n"
        f"取得日時: {fetched_at}\n"
        f"記事件数: {article_count} 件\n\n"
        f"{articles_text}\n\n"
        f"🔗 LP: https://ytsukuda4470.github.io/kaigo-joho-kiban-lp/"
    )

    payload = json.dumps({"text": message}).encode("utf-8")
    req = urllib.request.Request(
        webhook_url,
        data=payload,
        headers={"Content-Type": "application/json"},
    )
    try:
        resp = urllib.request.urlopen(req, timeout=10)
        print(f"[OK] 通知送信完了 status={resp.status}")
    except Exception as e:
        print(f"[ERROR] 通知送信失敗: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
