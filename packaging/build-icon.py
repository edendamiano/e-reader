from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image


def main() -> None:
    source = Path(sys.argv[1]).resolve()
    target = Path(sys.argv[2]).resolve()
    image = Image.open(source).convert("RGBA")
    if image.getbbox() is None or any(image.getpixel(point)[3] != 0 for point in [(0, 0), (image.width - 1, 0), (0, image.height - 1), (image.width - 1, image.height - 1)]):
        raise RuntimeError("Icon source must have transparent corners and visible content.")
    target.parent.mkdir(parents=True, exist_ok=True)
    image.save(target, format="ICO", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    print(f"{target} ({target.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
