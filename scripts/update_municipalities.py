#!/usr/bin/env python3
"""
介護情報基盤 自治体情報自動更新スクリプト

実行内容:
  1. 介護情報基盤ポータル PDF をダウンロードしてパース
  2. data/municipalities.json を更新
  3. 新しい自治体が追加された場合 data/news.json にも追記
  4. 変更サマリーを JSON で stdout に出力（GitHub Actions の GITHUB_OUTPUT に利用）
"""

import json
import os
import re
import sys
import tempfile
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Optional

# ──────────────────────────────────────────
# 設定
# ──────────────────────────────────────────

PDF_URL = "https://www.kaigo-kiban-portal.jp/assets/pdf/taioujyoukyou.pdf"

PORTAL_BASE = "https://www.kaigo-kiban-portal.jp/introduction-map/{region}"

# 都道府県 → ポータルURLのリージョン識別子
PREF_TO_REGION = {
    "北海道": "hokkaido",
    "青森県": "aomori", "岩手県": "iwate", "宮城県": "miyagi",
    "秋田県": "akita", "山形県": "yamagata", "福島県": "fukushima",
    "茨城県": "ibaraki", "栃木県": "tochigi", "群馬県": "gunma",
    "埼玉県": "saitama", "千葉県": "chiba", "東京都": "tokyo",
    "神奈川県": "kanagawa", "神奈川": "kanagawa",
    "新潟県": "niigata", "富山県": "toyama", "石川県": "ishikawa",
    "福井県": "fukui", "山梨県": "yamanashi", "長野県": "nagano",
    "岐阜県": "gifu", "静岡県": "shizuoka", "愛知県": "aichi",
    "三重県": "mie", "滋賀県": "shiga", "京都府": "kyoto",
    "大阪府": "osaka", "兵庫県": "hyogo", "奈良県": "nara",
    "和歌山県": "wakayama", "鳥取県": "tottori", "島根県": "shimane",
    "岡山県": "okayama", "広島県": "hiroshima", "山口県": "yamaguchi",
    "徳島県": "tokushima", "香川県": "kagawa", "愛媛県": "ehime",
    "高知県": "kochi", "福岡県": "fukuoka", "佐賀県": "saga",
    "長崎県": "nagasaki", "熊本県": "kumamoto", "大分県": "oita",
    "宮崎県": "miyazaki", "鹿児島県": "kagoshima", "沖縄県": "okinawa",
}

# スクリプトのあるディレクトリの親 = LP ルート
SCRIPT_DIR = Path(__file__).parent
LP_ROOT = SCRIPT_DIR.parent
DATA_DIR = LP_ROOT / "data"
MUNICIPALITIES_JSON = DATA_DIR / "municipalities.json"
NEWS_JSON = DATA_DIR / "news.json"

JST = timezone(timedelta(hours=9))


# ──────────────────────────────────────────
# ユーティリティ
# ──────────────────────────────────────────

def log(msg: str) -> None:
    print(f"[{datetime.now(JST).strftime('%H:%M:%S')}] {msg}", file=sys.stderr)


def get_portal_url(prefecture: str) -> str:
    region = PREF_TO_REGION.get(prefecture, "")
    if region:
        return PORTAL_BASE.format(region=region)
    return "https://www.kaigo-kiban-portal.jp/"


def download_pdf(url: str) -> Optional[bytes]:
    """PDF をダウンロードして bytes を返す"""
    try:
        import requests
        headers = {
            "User-Agent": (
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/120.0.0.0 Safari/537.36"
            )
        }
        resp = requests.get(url, headers=headers, timeout=60)
        resp.raise_for_status()
        return resp.content
    except Exception as e:
        log(f"PDF ダウンロード失敗: {e}")
        return None


def parse_municipalities_from_pdf(pdf_bytes: bytes) -> list[dict]:
    """
    PDF テキストから 2026年 実施自治体を抽出して返す
    戻り値: [{"name": ..., "prefecture": ..., "implementationDate": ..., ...}, ...]
    """
    try:
        import pdfplumber
        import io
    except ImportError:
        log("pdfplumber がインストールされていません: pip install pdfplumber")
        return []

    pref_pattern = re.compile(
        r"^(北海道（[^）]+）|北海道|青森県|岩手県|宮城県|秋田県|山形県|福島県|"
        r"茨城県|栃木県|群馬県|埼玉県|千葉県|東京都|神奈川|新潟県|富山県|石川県|"
        r"福井県|山梨県|長野県|岐阜県|静岡県|愛知県|三重県|滋賀県|京都府|大阪府|"
        r"兵庫県|奈良県|和歌山県|鳥取県|島根県|岡山県|広島県|山口県|徳島県|"
        r"香川県|愛媛県|高知県|福岡県|佐賀県|長崎県|熊本県|大分県|宮崎県|"
        r"鹿児島県|沖縄県)"
    )

    all_text = ""
    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        for page in pdf.pages:
            txt = page.extract_text()
            if txt:
                all_text += txt + "\n"

    lines = all_text.split("\n")
    results = []
    seen = set()

    for line in lines:
        dates = re.findall(r"(\d{4}/\d{1,2}/\d{1,2})", line)
        if not dates:
            continue

        impl_date_str = dates[0]
        # 2026年の実施日のみ対象
        if not impl_date_str.startswith("2026/"):
            continue

        m = pref_pattern.match(line)
        if not m:
            line2 = re.sub(r"（[^）]+）", "", line).strip()
            m = pref_pattern.match(line2)
        if not m:
            continue

        raw_pref = m.group(1)
        # 「北海道（道央）」→「北海道」に正規化
        pref = re.sub(r"（[^）]+）", "", raw_pref).strip()

        # 市区町村名を抽出
        city_part = line.strip()
        city_part = re.sub(r"北海道（[^）]+）", "北海道", city_part)
        city_part = re.sub(pref_pattern, "", city_part, count=1).strip()
        city_part = re.sub(r"\d{4}/\d{1,2}/\d{1,2}", "", city_part).strip()
        city_part = re.sub(r"（[^）]+）", "", city_part).strip()
        city_name = city_part.strip()

        if not city_name or len(city_name) >= 20:
            continue

        # 日付を YYYY-MM-DD 形式に変換
        parts = impl_date_str.split("/")
        impl_date = f"{parts[0]}-{int(parts[1]):02d}-{int(parts[2]):02d}"

        key = (pref, city_name)
        if key in seen:
            continue
        seen.add(key)

        results.append({
            "name": city_name,
            "prefecture": pref,
            "implementationDate": impl_date,
            "status": "実施予定",
            "url": get_portal_url(pref),
            "notes": "",
        })

    results.sort(key=lambda x: x["implementationDate"])
    return results


def load_existing_municipalities() -> dict:
    """既存の municipalities.json を読み込む"""
    if MUNICIPALITIES_JSON.exists():
        try:
            with open(MUNICIPALITIES_JSON, encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            log(f"municipalities.json 読み込み失敗: {e}")
    return {"lastUpdated": "", "municipalities": []}


def load_news() -> dict:
    """既存の news.json を読み込む"""
    if NEWS_JSON.exists():
        try:
            with open(NEWS_JSON, encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            log(f"news.json 読み込み失敗: {e}")
    return {"lastUpdated": "", "news": []}


def save_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")


# ──────────────────────────────────────────
# メイン処理
# ──────────────────────────────────────────

def main() -> None:
    today = datetime.now(JST).strftime("%Y-%m-%d")
    log(f"自治体情報更新スクリプト開始 ({today})")

    # ── 1. PDF ダウンロード & パース ──
    log(f"PDF をダウンロード中: {PDF_URL}")
    pdf_bytes = download_pdf(PDF_URL)

    new_municipalities: list[dict] = []
    if pdf_bytes:
        log("PDF パース中...")
        new_municipalities = parse_municipalities_from_pdf(pdf_bytes)
        log(f"  → {len(new_municipalities)} 件の 2026年実施自治体を検出")
    else:
        log("PDF の取得に失敗したため、既存データを維持します")

    # ── 2. 既存データとマージ ──
    existing_data = load_existing_municipalities()
    existing_list: list[dict] = existing_data.get("municipalities", [])
    existing_keys = {(m["prefecture"], m["name"]) for m in existing_list}

    added_count = 0
    added_names: list[str] = []

    if new_municipalities:
        # 新規追加分を検出
        for m in new_municipalities:
            key = (m["prefecture"], m["name"])
            if key not in existing_keys:
                added_count += 1
                added_names.append(f"{m['prefecture']} {m['name']}")

        # 完全上書き（PDFが最新情報源）
        merged = new_municipalities
    else:
        # PDF 取得失敗時は既存を維持
        merged = existing_list

    # ステータスを更新（実施日が過去になったものを「実施中」に）
    today_dt = datetime.strptime(today, "%Y-%m-%d")
    for m in merged:
        try:
            impl_dt = datetime.strptime(m["implementationDate"], "%Y-%m-%d")
            m["status"] = "実施中" if impl_dt <= today_dt else "実施予定"
        except ValueError:
            pass

    updated_data = {
        "lastUpdated": today,
        "source": "介護情報基盤ポータル（https://www.kaigo-kiban-portal.jp/assets/pdf/taioujyoukyou.pdf）",
        "municipalities": merged,
    }

    # ── 3. municipalities.json 保存 ──
    save_json(MUNICIPALITIES_JSON, updated_data)
    log(f"municipalities.json を保存しました（{len(merged)} 件）")

    # ── 4. news.json に新規追加があれば追記 ──
    news_data = load_news()
    news_list: list[dict] = news_data.get("news", [])

    if added_count > 0:
        news_id = f"municipality-added-{today}"
        existing_news_ids = {n.get("id", "") for n in news_list}
        if news_id not in existing_news_ids:
            news_item = {
                "id": news_id,
                "date": today[:7],  # "YYYY-MM"
                "source": "介護情報基盤ポータル",
                "title": f"介護情報基盤 実施自治体更新 — 新規{added_count}件追加（{today}）",
                "url": "https://www.kaigo-kiban-portal.jp/assets/pdf/taioujyoukyou.pdf",
                "category": "自治体情報",
                "isNew": True,
            }
            news_list.insert(0, news_item)
            news_data["news"] = news_list
            news_data["lastUpdated"] = today
            save_json(NEWS_JSON, news_data)
            log(f"news.json に新着ニュースを追加しました: {news_id}")

    # ── 5. 結果サマリーを JSON で stdout 出力 ──
    result = {
        "success": True,
        "date": today,
        "total": len(merged),
        "new_count": added_count,
        "added_names": added_names[:10],  # 最大10件
        "pdf_fetched": pdf_bytes is not None,
    }
    print(json.dumps(result, ensure_ascii=False))
    log("完了")


if __name__ == "__main__":
    main()
