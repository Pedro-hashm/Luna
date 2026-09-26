import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.provider import OpenWakeWordProvider, WakeProviderPool


class FakeModel:
    def __init__(self):
        self.calls = []
        self.resets = 0

    def predict(self, samples):
        self.calls.append(samples.copy())
        return {"luna": 0.8}

    def reset(self):
        self.resets += 1


class WakeProviderTests(unittest.TestCase):
    def test_threshold_and_result_contract(self):
        engine = FakeModel()
        provider = OpenWakeWordProvider(Path("luna.onnx"), rms_gate=0, engine=engine)
        frame = np.full(1280, 2000, dtype=np.int16).tobytes()
        self.assertTrue(provider.predict(frame, 0.7).detected)
        result = provider.predict(frame, 0.9)
        self.assertFalse(result.detected)
        self.assertEqual(result.score, 0.8)
        self.assertEqual(result.model, "luna")
        self.assertGreater(result.timestamp, 0)
        self.assertEqual(len(engine.calls), 2)

    def test_quiet_gate_saves_inference_and_preserves_preroll(self):
        engine = FakeModel()
        provider = OpenWakeWordProvider(Path("luna.onnx"), rms_gate=0.003, engine=engine)
        silence = np.zeros(1280, dtype=np.int16).tobytes()
        for _ in range(6):
            self.assertFalse(provider.predict(silence, 0.5).detected)
        self.assertEqual(engine.calls, [])
        speech = np.full(1280, 1000, dtype=np.int16).tobytes()
        self.assertTrue(provider.predict(speech, 0.5).detected)
        self.assertEqual(engine.calls[0].size, 7 * 1280)
        self.assertEqual(len(engine.calls), 1)

    def test_invalid_pcm_and_threshold(self):
        provider = OpenWakeWordProvider(Path("luna.onnx"), engine=FakeModel())
        with self.assertRaises(ValueError):
            provider.predict(b"\x00", 0.5)
        with self.assertRaises(ValueError):
            provider.predict(b"\x00\x00", 1.1)

    def test_missing_model_and_verifier_fail_closed(self):
        pool = WakeProviderPool(Path("missing-luna.onnx"))
        self.assertFalse(pool.ready)
        with self.assertRaises(FileNotFoundError):
            pool.get("session")
        with self.assertRaises(FileNotFoundError):
            pool.get("session", verifier_enabled=True)
        with self.assertRaises(ValueError):
            pool.get("session", verifier_enabled=True, verifier_model="../outside.pkl")

    def test_reset_reuses_loaded_model_until_session_release(self):
        with tempfile.TemporaryDirectory() as directory:
            model = Path(directory) / "luna.onnx"
            model.write_bytes(b"test model path")
            with patch("app.provider.OpenWakeWordProvider") as factory:
                factory.side_effect = lambda *args, **kwargs: MagicMock()
                pool = WakeProviderPool(model)
                self.assertEqual(pool.active_sessions, 0)  # startup probe released
                first = pool.get("session")
                pool.reset("session")
                self.assertIs(pool.get("session"), first)
                self.assertEqual(factory.call_count, 2)  # probe + one session
                first.reset.assert_called_once()
                pool.reset("session", release=True)
                self.assertEqual(pool.active_sessions, 0)
                self.assertIsNot(pool.get("session"), first)
                self.assertEqual(factory.call_count, 3)


if __name__ == "__main__":
    unittest.main()
