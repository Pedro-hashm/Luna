"""Shared paths and audio conversion for the isolated wake training tools."""

from __future__ import annotations

import json
import shutil
import subprocess
import wave
from pathlib import Path

import numpy as np
import yaml


ROOT = Path(__file__).resolve().parents[1]
REPO = ROOT.parents[1]
DATA = ROOT / "data"
ALLOWED_AUDIO = {".wav", ".flac", ".mp3", ".ogg", ".m4a", ".opus", ".webm"}


def load_config(path: Path | None = None) -> dict:
    path = path or ROOT / "config" / "luna.yml"
    config = yaml.safe_load(path.read_text(encoding="utf-8"))
    if config.get("keyword", "").casefold() != "luna":
        raise ValueError("This pipeline is configured for the custom Luna model")
    if config.get("sample_rate") != 16000:
        raise ValueError("openWakeWord requires 16 kHz audio")
    return config


def require_ffmpeg() -> str:
    executable = shutil.which("ffmpeg")
    if not executable:
        raise RuntimeError("ffmpeg is required to normalize audio. Install ffmpeg and retry.")
    return executable


def convert_to_wav(source: Path, target: Path, *, max_seconds: float | None = None) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    command = [require_ffmpeg(), "-hide_banner", "-loglevel", "error", "-y", "-i", str(source)]
    if max_seconds is not None:
        command += ["-t", str(max_seconds)]
    command += ["-ac", "1", "-ar", "16000", "-sample_fmt", "s16", "-acodec", "pcm_s16le", str(target)]
    subprocess.run(command, check=True, capture_output=True, text=True)
    read_wav(target)  # validate format and non-empty audio


def read_wav(path: Path) -> np.ndarray:
    with wave.open(str(path), "rb") as wav:
        if wav.getframerate() != 16000 or wav.getnchannels() != 1 or wav.getsampwidth() != 2:
            raise ValueError(f"Expected mono 16 kHz PCM16 WAV: {path}")
        data = np.frombuffer(wav.readframes(wav.getnframes()), dtype="<i2").copy()
    if data.size < 1600:
        raise ValueError(f"Audio is shorter than 100 ms: {path}")
    return data


def write_wav(path: Path, samples: np.ndarray) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(16000)
        wav.writeframes(np.asarray(samples, dtype="<i2").tobytes())


def write_json(path: Path, value: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
