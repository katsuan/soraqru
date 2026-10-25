#!/usr/bin/env python3
"""国土地理院の市区町村コードの表（https://maps.gsi.go.jp/js/muni.js）から、
コード → 名前（例：23105 → 名古屋市中村区）の data/muni.json を作る。現在地の地名を出すのに使う。

muni.js はスクリプトなので、ページでは読まず、ここで文字として読んで表だけにする。
使い方（リポジトリのフォルダで）: python3 tools/muni.py
"""
import json
import re
import urllib.request
from pathlib import Path

URL = "https://maps.gsi.go.jp/js/muni.js"
OUT = Path(__file__).resolve().parent.parent / "data" / "muni.json"
ROW = re.compile(r"MUNI_ARRAY\[\"(\d+)\"\]\s*=\s*'(\d+),([^,]+),(\d+),([^']+)'")


# 市区町村の表を読みこみ、data/muni.json（コード → 名前）を書き出す（python3 tools/muni.py で動かす）
def main():
    text = urllib.request.urlopen(URL, timeout=30).read().decode("utf-8")
    table = {}
    for code, _pref_no, _pref, _code2, name in ROW.findall(text):
        name = re.sub(r"[\s　]+", "", name)
        if name:
            table[str(int(code))] = name
    if len(table) < 1500:
        raise SystemExit(f"表が少なすぎます（{len(table)} 件）。muni.js の形が変わったかもしれません")
    OUT.write_text(json.dumps(table, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"{OUT.relative_to(OUT.parent.parent)}: {len(table)} 件")


if __name__ == "__main__":
    main()
