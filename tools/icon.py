#!/usr/bin/env python3
"""そらくる（SoraQru）のアイコン・ロゴ・OGP を作る。

名前は「そらくる」（空＋くる。空のようすが先に来る）。英字は SoraQru（「く」を Q にする。おくるん＝OQRN・つづく＝TsuduQ と同じ作り方）。
アイコンはおくるんと同じ角の丸い四角に、すみれ色がかった空から群青へのグラデーション（ほかの Q のツールと重ならない空の色）。
Q は晴れ間：輪がまるごと黄色い太陽（まわりに短い光）、右下へのびるしっぽは、太陽にかかる白い雲。

  icon.svg・icon-32.png・apple-touch-icon.png・icon-512.png・icon-maskable-512.png … アイコン
  logo.svg … 横長のロゴ「SoraQru」（Jua。Q はアイコンと同じ形）
  ogp.png  … 共有したときの画像（1200×630）

使い方: python3 tools/icon.py（となりのおくるん（q-oqrn）の tools/brandkit.py を使う）
"""
from pathlib import Path

import brandkit_path  # noqa: F401
from brandkit import Brand, centered, polar

ROOT = Path(__file__).resolve().parent.parent
BRAND = Brand(light=(150, 172, 255), dark=(58, 86, 214))  # style.css の --ls-accent #3a56d6
SUN = (255, 196, 64)

C = (44, 44)
R, RING_W = 23, 12.5


def cloud(cx, cy, k=1.0, fill="white"):
    """ぽっかり雲：丸を3つと、平らな底"""
    return [
        {"t": "circle", "c": (cx - 6.2 * k, cy + 1.6 * k), "r": 5.2 * k, "fill": fill},
        {"t": "circle", "c": (cx + 0.6 * k, cy - 2.6 * k), "r": 7.2 * k, "fill": fill},
        {"t": "circle", "c": (cx + 7.4 * k, cy + 1.8 * k), "r": 5.0 * k, "fill": fill},
        {"t": "rect", "box": (cx - 11.6 * k, cy + 1.6 * k, cx + 12.4 * k, cy + 6.8 * k), "rx": 2.6 * k, "fill": fill},
    ]


TAIL = polar(C, 45, 37)
RAY_IN, RAY_OUT = R + RING_W / 2 + 2.6, R + RING_W / 2 + 6.4
SHAPES = [
    # Q の輪がまるごと太陽：黄色い輪と、まわりの短い光（雲にかくれる右下の光は描かない）。
    # 光はアイコンだけ（deco）。ロゴの Q は、字と同じ大きさで Q と読めるよう、太い輪と雲のしっぽだけにする
    *[{"t": "line", "p": [polar(C, a, RAY_IN), polar(C, a, RAY_OUT)], "w": 3.6, "fill": SUN, "deco": True} for a in range(0, 360, 45) if a != 45],
    {"t": "ring", "c": C, "r": R, "w": RING_W, "fill": SUN},
    # しっぽ：太陽にかかる白い雲（まわりを背景の色で少し削って、輪と見分ける）
    *cloud(TAIL[0], TAIL[1], 1.62, "bg"),
    *cloud(TAIL[0], TAIL[1], 1.36),
]
SHAPES, (_DX, _DY) = centered(SHAPES)
C = (C[0] + _DX, C[1] + _DY)
RING_OUTER = R + RING_W / 2


def decorate(d, s):
    """OGP の背景：うっすら雲"""
    for x, y, k, a in ((1010, 110, 3.2, 70), (1130, 520, 2.2, 55), (620, 560, 1.6, 45)):
        for sh in cloud(x, y, k):
            if sh["t"] == "circle":
                (cx, cy), r = sh["c"], sh["r"]
                d.ellipse(((cx - r) * s, (cy - r) * s, (cx + r) * s, (cy + r) * s), fill=(255, 255, 255, a))
            else:
                x0, y0, x1, y1 = sh["box"]
                d.rounded_rectangle((x0 * s, y0 * s, x1 * s, y1 * s), radius=sh["rx"] * s, fill=(255, 255, 255, a))


def main():
    BRAND.write_icons(ROOT, SHAPES)
    logo, ratio = BRAND.logo_svg("SoraQru", SHAPES, C, RING_OUTER, "SoraQru（そらくる）")
    (ROOT / "logo.svg").write_text(logo, encoding="utf-8")
    BRAND.write_ogp(
        ROOT / "ogp.png", SHAPES, "そらくる", "SoraQru",
        ["今日・明日の天気と、気圧の変化の目安", "時間ごとの色の帯で、ひと目で"], decorate,
        copy="空のごきげん、先どり",
    )
    print(f"アイコン・logo.svg（高さ 28px なら幅 {28 * ratio:.0f}px）・ogp.png を書き出しました")


if __name__ == "__main__":
    main()
