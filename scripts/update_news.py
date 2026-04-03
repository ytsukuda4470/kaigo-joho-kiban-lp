#!/usr/bin/env python3
"""
介護情報基盤 ニュース自動収集スクリプト
- Joint介護, GemMed, 介護経営ドットコム をスクレイピング
- index.html の NEWS_ITEMS_START〜END を更新
- index.html の REVISION_ITEMS_START〜END を更新
- 新着記事リストを JSON で stdout に出力（GitHub Actions で webhook 通知に利用）
"""

import json
import os
import re
import subprocess
import sys
from datetime import datetime, timezone, timedelta
from html import escape
from pathlib import Path
from typing import Optional

import requests
from bs4 import BeautifulSoup

# ============================
# 設定
# ============================

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    )
}

KEYWORD = "介護情報基盤"
MAX_ARTICLES = 8  # 表示最大件数

# 固定エントリ（常に表示）
FIXED_ARTICLES = [
    {
        "date": "2025/12",
        "source": "厚生労働省",
        "title": "介護情報基盤について（厚生労働省 公式ページ）——制度概要・自治体向け情報",
        "url": "https://www.mhlw.go.jp/stf/newpage_59231.html",
        "fixed": True,
    }
]


def fetch(url: str, timeout: int = 15) -> Optional[BeautifulSoup]:
    try:
        r = requests.get(url, headers=HEADERS, timeout=timeout)
        r.raise_for_status()
        r.encoding = r.apparent_encoding
        return BeautifulSoup(r.text, "html.parser")
    except Exception as e:
        print(f"[WARN] fetch failed: {url} — {e}", file=sys.stderr)
        return None


def parse_date_jp(text: str) -> str:
    """様々な日付フォーマットを YYYY/MM に変換"""
    text = text.strip()
    patterns = [
        (r"(\d{4})[年/\-](\d{1,2})[月/\-](\d{1,2})", lambda m: f"{m.group(1)}/{int(m.group(2)):02d}"),
        (r"(\d{4})[年/\-](\d{1,2})[月]?", lambda m: f"{m.group(1)}/{int(m.group(2)):02d}"),
        (r"令和(\d+)年(\d+)月", lambda m: f"{2018 + int(m.group(1))}/{int(m.group(2)):02d}"),
    ]
    for pattern, fmt in patterns:
        m = re.search(pattern, text)
        if m:
            return fmt(m)
    return datetime.now(tz=timezone(timedelta(hours=9))).strftime("%Y/%m")


# ============================
# スクレイパー: Joint 介護
# ============================

def scrape_joint() -> list[dict]:
    url = f"https://www.joint-kaigo.com/?s={KEYWORD}"
    soup = fetch(url)
    if not soup:
        return []
    articles = []
    for item in soup.select("article, .post, .article-item")[:10]:
        title_el = item.select_one("h2, h3, .entry-title, .post-title")
        link_el = item.select_one("a[href]")
        date_el = item.select_one("time, .date, .published, .post-date")
        if not title_el or not link_el:
            continue
        title = title_el.get_text(strip=True)
        if KEYWORD not in title:
            continue
        href = link_el["href"]
        if not href.startswith("http"):
            href = "https://www.joint-kaigo.com" + href
        date_str = parse_date_jp(date_el.get_text() if date_el else "")
        articles.append({
            "date": date_str,
            "source": "Joint",
            "title": title,
            "url": href,
            "fixed": False,
        })
    return articles


# ============================
# スクレイパー: GemMed
# ============================

def scrape_gemmed() -> list[dict]:
    url = f"https://gemmed.ghc-j.com/?s={KEYWORD}"
    soup = fetch(url)
    if not soup:
        return []
    articles = []
    for item in soup.select("article, .post, li.item")[:10]:
        title_el = item.select_one("h2, h3, .entry-title, .post-title")
        link_el = item.select_one("a[href]")
        date_el = item.select_one("time, .date, .published, .entry-date")
        if not title_el or not link_el:
            continue
        title = title_el.get_text(strip=True)
        if KEYWORD not in title:
            continue
        href = link_el["href"]
        if not href.startswith("http"):
            href = "https://gemmed.ghc-j.com" + href
        date_str = parse_date_jp(date_el.get_text() if date_el else "")
        articles.append({
            "date": date_str,
            "source": "GemMed",
            "title": title,
            "url": href,
            "fixed": False,
        })
    return articles


# ============================
# スクレイパー: 介護経営ドットコム
# ============================

def scrape_kaigokeiei() -> list[dict]:
    url = f"https://kaigokeiei.com/?s={KEYWORD}"
    soup = fetch(url)
    if not soup:
        return []
    articles = []
    for item in soup.select("article, .post, .news-item")[:10]:
        title_el = item.select_one("h2, h3, .entry-title, .post-title")
        link_el = item.select_one("a[href]")
        date_el = item.select_one("time, .date, .published, .entry-date")
        if not title_el or not link_el:
            continue
        title = title_el.get_text(strip=True)
        if KEYWORD not in title:
            continue
        href = link_el["href"]
        if not href.startswith("http"):
            href = "https://kaigokeiei.com" + href
        date_str = parse_date_jp(date_el.get_text() if date_el else "")
        articles.append({
            "date": date_str,
            "source": "介護経営",
            "title": title,
            "url": href,
            "fixed": False,
        })
    return articles


# ============================
# スクレイパー: 厚生労働省ニュース
# ============================

def scrape_mhlw() -> list[dict]:
    url = "https://www.mhlw.go.jp/stf/newpage_59231.html"
    soup = fetch(url)
    if not soup:
        return []
    # ページタイトルを取得して固定エントリを最新化
    title_el = soup.select_one("h1, h2, .page-title")
    if title_el:
        title = title_el.get_text(strip=True)[:60]
        # 日付はページ更新日を探す
        date_el = soup.select_one(".update, .date, time")
        date_str = parse_date_jp(date_el.get_text() if date_el else "2025/12")
        return [{
            "date": date_str,
            "source": "厚生労働省",
            "title": f"{title}（厚生労働省 公式）",
            "url": url,
            "fixed": True,
        }]
    return []


# ============================
# HTML 生成
# ============================

def article_to_html(art: dict) -> str:
    title = art["title"][:60] + "…" if len(art["title"]) > 60 else art["title"]
    return f"""                <a href="{art['url']}" target="_blank" rel="noopener noreferrer"
                   class="reveal flex gap-4 bg-white rounded-xl p-4 shadow-sm hover:shadow-md transition-shadow border border-gray-100 group">
                    <div class="flex-shrink-0 text-center">
                        <span class="block text-xs text-gray-400">{art['date']}</span>
                        <span class="block text-xs font-bold text-primary">{art['source']}</span>
                    </div>
                    <div class="flex-1 min-w-0">
                        <p class="text-sm font-medium text-gray-800 group-hover:text-primary transition-colors line-clamp-2">
                            {title}
                        </p>
                        <span class="mt-1 inline-flex items-center text-xs text-primary/70">
                            <i class="fas fa-external-link-alt mr-1 text-xs"></i>記事を読む
                        </span>
                    </div>
                </a>"""


def get_revision_entries(repo_root: Path, limit: int = 6) -> list[dict]:
    """git log から LP 改訂履歴を取得"""
    cmd = [
        "git", "-C", str(repo_root), "log",
        f"-n{limit}",
        "--date=format:%Y/%m/%d",
        "--pretty=format:%ad||%h||%s",
    ]
    try:
        out = subprocess.check_output(cmd, text=True, stderr=subprocess.DEVNULL)
    except Exception:
        return []

    repo = os.getenv("GITHUB_REPOSITORY", "").strip()
    rows = []
    for line in out.splitlines():
        parts = line.split("||", 2)
        if len(parts) != 3:
            continue
        date, short_hash, subject = parts
        is_auto = "ニュース自動更新" in subject
        commit_url = f"https://github.com/{repo}/commit/{short_hash}" if repo else ""
        rows.append({
            "date": date,
            "hash": short_hash,
            "subject": subject,
            "is_auto": is_auto,
            "url": commit_url,
        })
    return rows


def revision_to_html(item: dict) -> str:
    tag_text = "自動更新" if item["is_auto"] else "手動更新"
    tag_class = "bg-primary/10 text-primary" if item["is_auto"] else "bg-accent/10 text-accent"
    title = escape(item["subject"])
    date = escape(item["date"])
    if item["url"]:
        hash_html = (
            f'<a href="{escape(item["url"])}" target="_blank" rel="noopener noreferrer" '
            f'class="text-xs text-primary hover:underline">{escape(item["hash"])}</a>'
        )
    else:
        hash_html = f'<span class="text-xs text-gray-500">{escape(item["hash"])}</span>'

    return f"""                    <div class="flex items-start justify-between gap-3 bg-[#F9F7F4] rounded-xl border border-gray-200 p-3">
                        <div>
                            <p class="text-sm font-bold text-gray-900">{title}</p>
                            <p class="text-xs text-gray-500 mt-1 inline-flex items-center gap-2">
                                <span class="px-2 py-0.5 rounded-full {tag_class}">{tag_text}</span>
                                {hash_html}
                            </p>
                        </div>
                        <span class="text-xs text-gray-400 whitespace-nowrap">{date}</span>
                    </div>"""


def update_html(articles: Optional[list[dict]], revisions: list[dict], html_path: Path) -> tuple[str, bool]:
    content = html_path.read_text(encoding="utf-8")
    changed = False

    new_content = content
    if articles is not None:
        new_items = "\n".join(article_to_html(a) for a in articles)
        new_block = (
            "                <!-- NEWS_ITEMS_START -->\n"
            + new_items
            + "\n                <!-- NEWS_ITEMS_END -->"
        )
        news_pattern = r"<!-- NEWS_ITEMS_START -->.*?<!-- NEWS_ITEMS_END -->"
        new_content, news_count = re.subn(news_pattern, new_block, content, flags=re.DOTALL)
        if news_count == 0:
            print("[ERROR] NEWS_ITEMS_START/END markers not found", file=sys.stderr)
            return content, False

        if new_content != content:
            changed = True

    if revisions:
        revision_items = "\n".join(revision_to_html(r) for r in revisions)
        revision_block = (
            "                    <!-- REVISION_ITEMS_START -->\n"
            + revision_items
            + "\n                    <!-- REVISION_ITEMS_END -->"
        )
        rev_pattern = r"<!-- REVISION_ITEMS_START -->.*?<!-- REVISION_ITEMS_END -->"
        newer_content, rev_count = re.subn(rev_pattern, revision_block, new_content, flags=re.DOTALL)
        if rev_count == 0:
            print("[WARN] REVISION_ITEMS_START/END markers not found", file=sys.stderr)
        else:
            if newer_content != new_content:
                changed = True
            new_content = newer_content

    if changed:
        html_path.write_text(new_content, encoding="utf-8")

    return new_content, changed


# ============================
# メイン
# ============================

def main():
    # スクレイピング
    print("[INFO] Scraping news...", file=sys.stderr)
    dynamic = []
    dynamic += scrape_joint()
    dynamic += scrape_gemmed()
    dynamic += scrape_kaigokeiei()

    # 厚生労働省を動的取得（固定エントリを最新化）
    mhlw = scrape_mhlw()
    fixed = mhlw if mhlw else FIXED_ARTICLES

    # 重複除去（URLベース）
    seen_urls = set()
    unique = []
    for a in dynamic:
        if a["url"] not in seen_urls:
            seen_urls.add(a["url"])
            unique.append(a)

    # 日付降順ソート
    unique.sort(key=lambda x: x["date"], reverse=True)

    # 固定エントリ + 動的エントリ (最大 MAX_ARTICLES 件)
    all_articles = fixed + unique[:MAX_ARTICLES - len(fixed)]

    print(f"[INFO] Total articles: {len(all_articles)}", file=sys.stderr)

    # 外部サイトの取得に失敗して動的記事が0件の場合はニュース欄を上書きしない
    update_news_items = all_articles if unique else None
    if update_news_items is None:
        print("[WARN] No dynamic articles found. Keep existing NEWS block.", file=sys.stderr)

    # HTML 更新
    html_path = Path(__file__).parent.parent / "index.html"
    repo_root = Path(__file__).parent.parent
    revisions = get_revision_entries(repo_root)
    _, changed = update_html(update_news_items, revisions, html_path)
    print(f"[INFO] HTML {'updated' if changed else 'unchanged'}", file=sys.stderr)

    # 結果を JSON で stdout に出力（GitHub Actions で利用）
    result = {
        "updated": changed,
        "article_count": len(all_articles),
        "revision_count": len(revisions),
        "articles": all_articles,
        "fetched_at": datetime.now(tz=timezone(timedelta(hours=9))).strftime("%Y-%m-%d %H:%M JST"),
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
