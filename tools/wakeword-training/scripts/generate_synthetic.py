"""Generate Luna and confusable-word clips using the existing Kokoro HTTP API."""

from __future__ import annotations

import argparse
import hashlib
import os
import random
import tempfile
from pathlib import Path

import requests

from common import DATA, convert_to_wav, load_config, write_json


def synthesize(base_url: str, model: str, phrase: str, voice: str, speed: float, target: Path) -> None:
    endpoint = base_url.rstrip("/") + "/v1/audio/speech"
    response = requests.post(
        endpoint,
        json={"model": model, "input": phrase, "voice": voice,
              "speed": speed, "response_format": "wav"},
        headers={"Accept": "audio/wav"},
        timeout=120,
    )
    response.raise_for_status()
    if not response.content.startswith(b"RIFF"):
        raise RuntimeError(f"Kokoro returned non-WAV audio from {endpoint}; check response_format support")
    with tempfile.TemporaryDirectory() as temp:
        raw = Path(temp) / "kokoro.wav"
        raw.write_bytes(response.content)
        convert_to_wav(raw, target, max_seconds=5.0)


def verify_portuguese_voices(base_url: str, voices: list[str], language: str) -> None:
    response = requests.get(base_url.rstrip("/") + "/v1/audio/voices", timeout=15)
    response.raise_for_status()
    payload = response.json()
    entries = payload.get("voices", []) if isinstance(payload, dict) else payload
    language_by_voice = {
        entry.get("id"): (entry.get("metadata") or {}).get("language_name")
        for entry in entries if isinstance(entry, dict) and isinstance(entry.get("id"), str)
    }
    wrong_language = {voice: language_by_voice.get(voice) for voice in voices
                      if language_by_voice.get(voice) != language}
    if wrong_language:
        details = ", ".join(f"{voice} ({locale or 'idioma desconhecido'})"
                             for voice, locale in wrong_language.items())
        raise ValueError(f"Wake positives must use {language} voices; rejected: {details}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path)
    parser.add_argument("--base-url", default=os.getenv("KOKORO_BASE_URL"))
    parser.add_argument("--count-per-voice-speed", type=int)
    parser.add_argument("--negative", action="store_true", help="Generate confusable negatives instead of Luna")
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()
    config = load_config(args.config)
    kokoro = config["kokoro"]
    base_url = args.base_url or kokoro["base_url"]
    count = args.count_per_voice_speed or kokoro["count_per_voice_speed"]
    if count < 1:
        parser.error("count-per-voice-speed must be positive")
    voices = kokoro["voices"]
    speeds = kokoro["speeds"]
    phrases = config["custom_negative_phrases"] if args.negative else [config["keyword"]]
    if not voices or not speeds or not phrases:
        parser.error("voices, speeds and phrases must be non-empty")
    verify_portuguese_voices(base_url, voices, kokoro["positive_language"])
    rng = random.Random(args.seed)
    target_dir = DATA / ("negative" if args.negative else "positive")
    target_dir.mkdir(parents=True, exist_ok=True)
    for voice in voices:
        for speed in speeds:
            for index in range(count):
                phrase = rng.choice(phrases)
                key = f"{voice}|{speed}|{index}|{phrase}|{args.seed}"
                name = hashlib.sha256(key.encode()).hexdigest()[:20] + ".wav"
                target = target_dir / name
                if target.exists():
                    continue
                try:
                    synthesize(base_url, kokoro["model"], phrase, voice, speed, target)
                except Exception:
                    target.unlink(missing_ok=True)
                    raise
                write_json(target.with_suffix(".json"), {
                    "source": "kokoro", "phrase": phrase, "voice": voice,
                    "speed": speed, "base_url": base_url,
                })
                print(target)


if __name__ == "__main__":
    main()
