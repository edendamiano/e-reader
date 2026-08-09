from __future__ import annotations

import re
import unicodedata


_CJK = re.compile(r"[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]")
_LATIN = re.compile(r"[A-Za-z]")


def detect_language(text: str) -> str:
    cjk = len(_CJK.findall(text))
    latin = len(_LATIN.findall(text))
    if cjk and latin and min(cjk, latin) >= 2:
        return "mixed"
    return "zh" if cjk > latin else "en"


class TextNormalizer:
    """Conservative normalization: improve pronunciation without rewriting meaning."""

    _spaces = re.compile(r"[ \t\f\v]+")
    _blank_lines = re.compile(r"\n{3,}")
    _space_before_punctuation = re.compile(r"\s+([,.;:!?，。；：！？、])")

    def normalize(self, text: str) -> str:
        value = unicodedata.normalize("NFC", text)
        value = value.replace("\ufeff", "").replace("\u00a0", " ")
        value = value.replace("\r\n", "\n").replace("\r", "\n")
        value = value.replace("...", "…").replace("..", "…")
        value = value.replace("——", "—")
        value = "\n".join(self._spaces.sub(" ", line).strip() for line in value.split("\n"))
        value = self._blank_lines.sub("\n\n", value)
        value = self._space_before_punctuation.sub(r"\1", value)
        return value.strip()
