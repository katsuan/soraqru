#!/usr/bin/env python3
"""天気の知らせボットの、トークの下のメニューの画像（gas/richmenu.png・2500×843）を作る。

3つに分ける（gas/0_setup.gs の setupRichMenu と同じ並び）：🌦️ 天気の知らせ ／ 📍 地点を足す ／ 🌤️ そらくるで見る
色はそらくるのアイコンと同じ（すみれ色がかった空 → 群青）。字はヒラギノ角ゴシック、絵文字は Apple Color Emoji（macOS）。

使い方: python3 tools/richmenu.py
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
W, H = 2500, 843
LIGHT, DARK = (150, 172, 255), (58, 86, 214)
HIRA8 = "/System/Library/Fonts/ヒラギノ角ゴシック W8.ttc"
PANELS = [("🌦️", "天気の知らせ", "いまの地点・時間"), ("📍", "地点を足す", "位置情報で登録"), ("🌤️", "そらくるで見る", "今日・明日の空")]


def emoji(ch, size):
    font = ImageFont.truetype("/System/Library/Fonts/Apple Color Emoji.ttc", 160)
    im = Image.new("RGBA", (200, 200), (0, 0, 0, 0))
    ImageDraw.Draw(im).text((100, 100), ch, font=font, embedded_color=True, anchor="mm")
    im = im.crop(im.getbbox())
    k = size / max(im.size)  # 縦横の比はそのまま
    return im.resize((round(im.width * k), round(im.height * k)), Image.LANCZOS)


def main():
    img = Image.new("RGB", (W, H))
    px = img.load()
    for y in range(H):
        for x in range(W):
            t = (x / (W - 1) + y / (H - 1)) / 2
            px[x, y] = tuple(round(LIGHT[i] + (DARK[i] - LIGHT[i]) * t) for i in range(3))
    img = img.convert("RGBA")
    # 白い板（押せるところ）は、うすく重ねる（同じ絵に直接描くと、透けずに真っ白になる）
    plates = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    pd = ImageDraw.Draw(plates)
    for i in range(3):
        pd.rounded_rectangle((W / 3 * i + 36, 40, W / 3 * (i + 1) - 36, H - 40), radius=64, fill=(255, 255, 255, 46))
    img = Image.alpha_composite(img, plates)
    d = ImageDraw.Draw(img)
    small = ImageFont.truetype("/System/Library/Fonts/ヒラギノ角ゴシック W6.ttc", 64)
    pw = W / 3
    for i, (ch, title, sub) in enumerate(PANELS):
        cx = pw * i + pw / 2
        e = emoji(ch, 230)
        img.alpha_composite(e, (int(cx - e.width / 2), int(225 - e.height / 2)))
        # 板の内側（左右 90px ずつあける）に収まる大きさに
        size = 112
        while size > 72 and d.textlength(title, font=ImageFont.truetype(HIRA8, size)) > pw - 72 - 180:
            size -= 2
        d.text((cx, 520), title, font=ImageFont.truetype(HIRA8, size), fill=(255, 255, 255), anchor="mm")
        d.text((cx, 650), sub, font=small, fill=(235, 240, 255), anchor="mm")
    out = ROOT / "gas" / "richmenu.png"
    img.convert("RGB").save(out, optimize=True)
    print(f"{out.relative_to(ROOT)}（{out.stat().st_size // 1024}KB）を書き出しました")


if __name__ == "__main__":
    main()
