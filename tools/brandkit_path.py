"""となりのおくるん（q-oqrn。GitHub の repo 名は oqrn。前は oqrn）の tools にある共通の描画スクリプト（brandkit.py）を読めるようにする。

おくるんと同じフォルダ（~/GitHub）に、このリポジトリを置いて使う。
"""
import sys
from pathlib import Path

HOME = Path(__file__).resolve().parents[2]
SHARED = next((HOME / name / "tools" for name in ("q-oqrn", "oqrn") if (HOME / name / "tools" / "brandkit.py").exists()), None)
if SHARED is None:
    sys.exit(f"共通の描画スクリプトが見つかりません：{HOME / 'q-oqrn' / 'tools' / 'brandkit.py'}（おくるん（q-oqrn）を同じフォルダに置いてください）")
sys.path.insert(0, str(SHARED))
