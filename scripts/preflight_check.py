#!/usr/bin/env python3
"""
Deployment preflight checker for 介護情報基盤LP.
Scans repo for unresolved placeholders and required files.
"""

from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

CHECKS = [
    {
        "name": "Firebase project id configured",
        "file": ROOT / "firebase-app/.firebaserc",
        "must_not_contain": ["YOUR_FIREBASE_PROJECT_ID"],
    },
    {
        "name": "Firebase web config configured",
        "file": ROOT / "firebase-app/public/firebase-config.js",
        "must_not_contain": [
            "YOUR_API_KEY",
            "YOUR_PROJECT_ID",
            "YOUR_SENDER_ID",
            "YOUR_APP_ID",
        ],
    },
]

REQUIRED_FILES = [
    ROOT / "assets/generated/hero-ai-placeholder.svg",
    ROOT / "assets/generated/GEMINI_IMAGE_PROMPTS.md",
    ROOT / "scripts/update_news.py",
    ROOT / "scripts/notify_gchat.py",
]


def read_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except FileNotFoundError:
        return ""


def check_gas_spreadsheet_property() -> tuple[bool, bool, str]:
    """
    Returns (ok, warn, message)

    ok=False  : hard failure
    warn=True : not verifiable in repo, user action required
    """
    code_path = ROOT / "gas-app/Code.gs"
    text = read_text(code_path)
    if not text:
        return False, False, f"file missing -> {code_path.relative_to(ROOT)}"

    pattern = r"SPREADSHEET_ID\s*=\s*PropertiesService\.getScriptProperties\(\)\.getProperty\('SPREADSHEET_ID'\)\s*\|\|\s*''"
    if re.search(pattern, text):
        return True, True, "SPREADSHEET_ID is expected via GAS Script Properties (cannot verify from repo)"

    return True, True, "SPREADSHEET_ID fallback logic changed; confirm GAS Script Properties manually"


def main() -> int:
    print("[Preflight] start")
    ok = True
    warn_count = 0

    for chk in CHECKS:
        text = read_text(chk["file"])
        if not text:
            ok = False
            print(f"[NG] {chk['name']}: file missing -> {chk['file'].relative_to(ROOT)}")
            continue
        bad = [t for t in chk["must_not_contain"] if t in text]
        if bad:
            ok = False
            print(f"[NG] {chk['name']}: unresolved placeholders -> {', '.join(bad)}")
        else:
            print(f"[OK] {chk['name']}")

    gas_ok, gas_warn, gas_msg = check_gas_spreadsheet_property()
    if not gas_ok:
        ok = False
        print(f"[NG] GAS spreadsheet id configured: {gas_msg}")
    elif gas_warn:
        warn_count += 1
        print(f"[WARN] GAS spreadsheet id configured: {gas_msg}")
    else:
        print("[OK] GAS spreadsheet id configured")

    for f in REQUIRED_FILES:
        if f.exists():
            print(f"[OK] file exists -> {f.relative_to(ROOT)}")
        else:
            ok = False
            print(f"[NG] file missing -> {f.relative_to(ROOT)}")

    if warn_count > 0:
        print(f"[Preflight] warnings: {warn_count}")
    print("[Preflight] done")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
