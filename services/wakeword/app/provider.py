"""Stateful wake detector behind a small provider interface.

Audio is mono, signed PCM16 little-endian at 16 kHz. openWakeWord's own
preprocessing and classifier stay in one process; no STT runs in idle.
"""

from __future__ import annotations

import math
import os
import re
import threading
import time
from collections import deque
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

import numpy as np


@dataclass(frozen=True)
class WakeResult:
    detected: bool
    score: float
    model: str
    timestamp: int


class WakeWordProvider(Protocol):
    def predict(self, pcm16: bytes, threshold: float) -> WakeResult: ...

    def reset(self) -> None: ...


class OpenWakeWordProvider:
    """A single stream's openWakeWord state.

    Quiet frames are held as pre-roll. After speech resumes they are flushed
    into openWakeWord before the active frame, preserving the leading phoneme.
    One provider must never be shared by two simultaneous audio streams.
    """

    def __init__(
        self,
        model_path: Path,
        verifier_path: Path | None = None,
        verifier_threshold: float = 0.1,
        rms_gate: float = 0.003,
        engine=None,
    ) -> None:
        self.model_path = Path(model_path)
        self.model_name = self.model_path.stem
        self.rms_gate = rms_gate
        self._lock = threading.Lock()
        self._quiet = deque(maxlen=6)  # 480 ms at 80 ms per request
        self._speaking = False
        self._quiet_hangover = 0
        if engine is None:
            if not self.model_path.is_file():
                raise FileNotFoundError(f"Wake model missing: {self.model_path}")
            from openwakeword.model import Model

            kwargs = {}
            if verifier_path is not None:
                verifier_path = Path(verifier_path)
                if not verifier_path.is_file():
                    raise FileNotFoundError(f"Wake verifier missing: {verifier_path}")
                # The verifier is a local trusted pickle written by train-verifier.
                kwargs = {
                    "custom_verifier_models": {self.model_name: str(verifier_path)},
                    "custom_verifier_threshold": verifier_threshold,
                }
            self._engine = Model(
                wakeword_models=[str(self.model_path)],
                inference_framework="onnx",
                vad_threshold=0,
                **kwargs,
            )
        else:
            self._engine = engine

    def predict(self, pcm16: bytes, threshold: float) -> WakeResult:
        if not pcm16 or len(pcm16) % 2:
            raise ValueError("Audio must be non-empty PCM16 little-endian bytes")
        if not math.isfinite(threshold) or not 0 <= threshold <= 1:
            raise ValueError("threshold must be between 0 and 1")
        samples = np.frombuffer(pcm16, dtype="<i2")
        if samples.size > 32_000:
            raise ValueError("Audio frame exceeds 2 seconds")
        with self._lock:
            if self.rms_gate > 0:
                rms = float(np.sqrt(np.mean(np.square(samples.astype(np.float32))))) / 32768
                if rms < self.rms_gate:
                    if self._speaking and self._quiet_hangover < 2:
                        self._quiet_hangover += 1
                    else:
                        if self._speaking:
                            self._engine.reset()
                            self._speaking = False
                        self._quiet.append(samples.copy())
                        return WakeResult(False, 0.0, self.model_name, int(time.time() * 1000))
                else:
                    if not self._speaking and self._quiet:
                        samples = np.concatenate((*self._quiet, samples))
                    self._quiet.clear()
                    self._speaking = True
                    self._quiet_hangover = 0
            prediction = self._engine.predict(samples)
            if self.model_name not in prediction:
                raise RuntimeError(f"Model returned no score for {self.model_name}")
            score = float(prediction[self.model_name])
            return WakeResult(score >= threshold, score, self.model_name, int(time.time() * 1000))

    def reset(self) -> None:
        with self._lock:
            self._engine.reset()
            self._quiet.clear()
            self._speaking = False
            self._quiet_hangover = 0


class WakeProviderPool:
    """Bounded, time-expiring provider registry keyed by VoiceSession id."""

    def __init__(self, model_path: Path, verifier_path: Path | None = None,
                 verifier_threshold: float = 0.1, rms_gate: float = 0.003,
                 ttl_seconds: int = 600, max_sessions: int = 8) -> None:
        self.model_path = model_path
        self.verifier_path = verifier_path
        self.verifier_threshold = verifier_threshold
        self.rms_gate = rms_gate
        self.ttl_seconds = ttl_seconds
        self.max_sessions = max_sessions
        self._lock = threading.Lock()
        self._sessions: dict[str, tuple[OpenWakeWordProvider, float, str | None, float]] = {}
        self._load_error: str | None = None
        if model_path.is_file():
            try:
                self.get("__startup_probe__")
                self.reset("__startup_probe__", release=True)
            except Exception as exc:
                self._load_error = str(exc)

    @property
    def ready(self) -> bool:
        return self.model_path.is_file() and self._load_error is None

    @property
    def load_error(self) -> str | None:
        return self._load_error

    def get(self, session_id: str, *, verifier_enabled: bool | None = None,
            verifier_model: str | None = None,
            verifier_threshold: float | None = None) -> OpenWakeWordProvider:
        if not session_id or len(session_id) > 128:
            raise ValueError("X-Voice-Session-Id must contain 1 to 128 characters")
        use_verifier = verifier_enabled if verifier_enabled is not None else self.verifier_path is not None
        trigger = verifier_threshold if verifier_threshold is not None else self.verifier_threshold
        if not math.isfinite(trigger) or not 0 <= trigger <= 1:
            raise ValueError("verifier_threshold must be between 0 and 1")
        verifier_path = None
        if use_verifier:
            name = verifier_model or (self.verifier_path.name if self.verifier_path else "luna_verifier.pkl")
            if not re.fullmatch(r"[A-Za-z0-9_.-]+\.pkl", name) or name in {".", ".."}:
                raise ValueError("verifier_model must be a local .pkl file name")
            verifier_path = self.model_path.parent / name
            if not verifier_path.is_file():
                raise FileNotFoundError(f"Wake verifier missing: {verifier_path}")
        signature = str(verifier_path) if verifier_path else None
        with self._lock:
            if not self.model_path.is_file():
                raise FileNotFoundError(f"Wake model missing: {self.model_path}")
            if self._load_error:
                raise RuntimeError(self._load_error)
            now = time.monotonic()
            for key, (_, last_seen, _, _) in tuple(self._sessions.items()):
                if now - last_seen > self.ttl_seconds:
                    del self._sessions[key]
            if session_id in self._sessions:
                provider, _, current_signature, current_trigger = self._sessions[session_id]
                if current_signature == signature and current_trigger == trigger:
                    self._sessions[session_id] = (provider, now, signature, trigger)
                    return provider
                del self._sessions[session_id]
            if len(self._sessions) >= self.max_sessions:
                oldest = min(self._sessions, key=lambda key: self._sessions[key][1])
                del self._sessions[oldest]
            try:
                provider = OpenWakeWordProvider(
                    self.model_path, verifier_path,
                    trigger, self.rms_gate,
                )
            except Exception as exc:
                self._load_error = str(exc)
                raise
            self._sessions[session_id] = (provider, now, signature, trigger)
            return provider

    def reset(self, session_id: str, release: bool = False) -> None:
        with self._lock:
            entry = self._sessions.pop(session_id, None) if release else self._sessions.get(session_id)
            if entry and not release:
                provider, _, signature, trigger = entry
                self._sessions[session_id] = (provider, time.monotonic(), signature, trigger)
        if entry and not release:
            entry[0].reset()

    def reload(self) -> None:
        with self._lock:
            self._sessions.clear()
            self._load_error = None
        if self.model_path.is_file():
            self.get("__reload_probe__")
            self.reset("__reload_probe__", release=True)

    @property
    def active_sessions(self) -> int:
        with self._lock:
            return len(self._sessions)


def pool_from_env() -> WakeProviderPool:
    model = Path(os.getenv("WAKE_MODEL_PATH", "/app/models/luna.onnx"))
    verifier = os.getenv("WAKE_VERIFIER_PATH")
    verifier_path = Path(verifier) if verifier else model.with_name(f"{model.stem}_verifier.pkl")
    if not verifier and not verifier_path.is_file():
        verifier_path = None
    return WakeProviderPool(
        model_path=model,
        verifier_path=verifier_path,
        verifier_threshold=float(os.getenv("WAKE_VERIFIER_THRESHOLD", "0.1")),
        rms_gate=float(os.getenv("WAKE_RMS_GATE", "0.003")),
    )
