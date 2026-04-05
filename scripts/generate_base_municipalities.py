#!/usr/bin/env python3
"""
全国市区町村ベースデータ生成スクリプト
geolonia/japanese-addresses API から取得して data/all_municipalities_base.json を生成する
"""
import json
import re
import urllib.request
import os

URL = "https://geolonia.github.io/japanese-addresses/api/ja.json"

def extract_muni(s):
    """
    "XX郡YY町" → "YY町"
    "XX市YY区" → "XX市"
    "XX市"     → "XX市"
    """
    # 郡プレフィックスを除去
    s = re.sub(r'^.+郡', '', s)
    # 市の後に区がつく場合（政令市の区）は市名だけ取得
    m = re.match(r'^(.+?市)', s)
    if m and len(s) > len(m.group(1)):
        remaining = s[len(m.group(1)):]
        if re.match(r'^[^ ]+区$', remaining):
            return m.group(1)
    return s

def main():
    print(f"Fetching: {URL}")
    with urllib.request.urlopen(URL) as r:
        data = json.loads(r.read().decode('utf-8'))

    municipalities = []
    seen = set()

    for pref, entries in data.items():
        for entry in entries:
            name = extract_muni(entry)
            key = f"{pref}_{name}"
            if key not in seen:
                seen.add(key)
                municipalities.append({"name": name, "prefecture": pref})

    # 都道府県・名前順にソート
    municipalities.sort(key=lambda x: (x['prefecture'], x['name']))

    output = {
        "count": len(municipalities),
        "municipalities": municipalities
    }

    out_path = os.path.join(os.path.dirname(__file__), '..', 'data', 'all_municipalities_base.json')
    out_path = os.path.normpath(out_path)
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(output, f, ensure_ascii=False, separators=(',', ':'))

    print(f"Generated: {out_path}")
    print(f"Total municipalities: {len(municipalities)}")

if __name__ == '__main__':
    main()
