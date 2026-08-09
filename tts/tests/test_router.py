from __future__ import annotations

import os
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

TTS_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TTS_ROOT))

from service.main import EngineRouter


class EngineRouterTests(unittest.TestCase):
    def test_cache_key_invalidates_on_every_versioned_input(self) -> None:
        with tempfile.TemporaryDirectory() as cache_dir:
            router = EngineRouter(Path(cache_dir))
            base = {"name": "stub", "model_version": "model-1", "voice_version": "voice-1", "prosody_profile_version": "prosody-1"}
            cases = [
                (base, "Sentence.", 1.0),
                ({**base, "model_version": "model-2"}, "Sentence.", 1.0),
                ({**base, "voice_version": "voice-2"}, "Sentence.", 1.0),
                ({**base, "prosody_profile_version": "prosody-2"}, "Sentence.", 1.0),
                (base, "Different sentence.", 1.0),
                (base, "Sentence.", 1.05),
            ]
            paths = {
                router._cache_path(SimpleNamespace(**attributes), text, speed)  # type: ignore[arg-type]
                for attributes, text, speed in cases
            }

            self.assertEqual(len(paths), len(cases))

    def test_kokoro_is_the_explicit_default_even_when_index_is_configured(self) -> None:
        with tempfile.TemporaryDirectory() as cache_dir:
            router = EngineRouter(Path(cache_dir))
            router.kokoro.load = Mock()
            router.index.configured = Mock(return_value=True)
            router.index.load = Mock()

            with patch.dict(os.environ, {"EREADER_TTS_ENGINE": "kokoro"}):
                router.warmup()

            self.assertIs(router.engine, router.kokoro)
            router.kokoro.load.assert_called_once_with()
            router.index.load.assert_not_called()

    def test_index_requires_an_explicit_preference_and_falls_back_to_kokoro(self) -> None:
        with tempfile.TemporaryDirectory() as cache_dir:
            router = EngineRouter(Path(cache_dir))
            router.index.load = Mock(side_effect=RuntimeError("load failed"))
            router.kokoro.load = Mock()

            with (
                patch.dict(os.environ, {"EREADER_TTS_ENGINE": "indextts2"}),
                patch("service.main.traceback.print_exc"),
            ):
                router.warmup()

            self.assertIs(router.engine, router.kokoro)
            router.index.load.assert_called_once_with()
            router.kokoro.load.assert_called_once_with()


if __name__ == "__main__":
    unittest.main()
