from __future__ import annotations

import sys
import unittest
from pathlib import Path

TTS_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TTS_ROOT))

from normalize import TextNormalizer, detect_language


class TextNormalizerTests(unittest.TestCase):
    def test_whitespace_and_unicode_punctuation(self) -> None:
        normalizer = TextNormalizer()
        self.assertEqual(normalizer.normalize(" 你好  ，  世界...\r\n\r\n\r\nNext. "), "你好， 世界…\n\nNext.")

    def test_mixed_language_is_not_split(self) -> None:
        text = "我们使用 Transformer architecture 解决这个问题。"
        self.assertEqual(detect_language(text), "mixed")
        self.assertEqual(TextNormalizer().normalize(text), text)

    def test_language_detection(self) -> None:
        self.assertEqual(detect_language("This is a sentence."), "en")
        self.assertEqual(detect_language("这是一句话。"), "zh")


if __name__ == "__main__":
    unittest.main()
