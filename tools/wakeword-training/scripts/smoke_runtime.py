"""Smoke the deployed wake HTTP service with held-out prepared audio."""

from __future__ import annotations

import argparse
import json
import os
import uuid
import wave
from pathlib import Path
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
BASE = os.environ.get("WAKEWORD_BASE_URL", "http://wakeword:8765").rstrip("/")
THRESHOLD = float(os.environ.get("WAKE_SMOKE_THRESHOLD", "0.97"))
LEAD_SECONDS = float(os.environ.get("WAKE_SMOKE_LEAD_SECONDS", "1.0"))
TAIL_SECONDS = float(os.environ.get("WAKE_SMOKE_TAIL_SECONDS", "1.0"))


def pcm(path: Path) -> bytes:
    with wave.open(str(path), "rb") as audio:
        if (audio.getnchannels(), audio.getframerate(), audio.getsampwidth()) != (1, 16000, 2):
            raise ValueError(f"Expected prepared mono PCM16 16 kHz: {path}")
        return audio.readframes(audio.getnframes())


def post(path: str, data: bytes, session: str, base: str) -> dict:
    request = Request(
        f"{base}{path}", data=data,
        headers={"content-type": "application/octet-stream", "x-voice-session-id": session},
        method="POST",
    )
    with urlopen(request, timeout=10) as response:
        return json.load(response)


def test_clip(path: Path, threshold: float, base: str) -> tuple[bool, float]:
    session = str(uuid.uuid4())
    samples = b"\0" * round(LEAD_SECONDS * 32000) + pcm(path) + b"\0" * round(TAIL_SECONDS * 32000)
    detected, peak = False, 0.0
    try:
        for offset in range(0, len(samples), 2560):
            frame = samples[offset:offset + 2560].ljust(2560, b"\0")
            result = post(f"/detect?threshold={threshold}", frame, session, base)
            detected |= result["detected"]
            peak = max(peak, float(result["score"]))
    finally:
        post("/reset", b"", session, base)
    return detected, peak


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--threshold", type=float, default=THRESHOLD)
    parser.add_argument("--base-url", default=BASE)
    parser.add_argument("--all", action="store_true", help="Use all held-out positive and negative clips")
    parser.add_argument("--negative-only", action="store_true", help="Only check near-negative clips")
    args = parser.parse_args()
    if not 0 <= args.threshold <= 1:
        parser.error("--threshold must be between 0 and 1")
    manifest = ROOT / "data/manifest.jsonl"
    rows = [json.loads(line) for line in manifest.read_text(encoding="utf-8").splitlines() if line]
    positives = [] if args.negative_only else [row for row in rows if row["split"] == "test" and row["label"] == "positive"]
    negatives = [row for row in rows if row["split"] == "test" and row["label"] == "negative"]
    if not args.all:
        positives, negatives = positives[:10], negatives[:10]
    if (not args.negative_only and len(positives) < 5) or len(negatives) < 5:
        raise SystemExit("Need at least 5 held-out clips per requested category")
    results = []
    for row in positives + negatives:
        detected, peak = test_clip(ROOT / row["path"], args.threshold, args.base_url.rstrip("/"))
        results.append({"label": row["label"], "source": row["source_path"], "detected": detected, "peak": round(peak, 4)})
    false_rejects = sum(not row["detected"] for row in results if row["label"] == "positive")
    false_accepts = sum(row["detected"] for row in results if row["label"] == "negative")
    print(json.dumps({"threshold": args.threshold, "leadSeconds": LEAD_SECONDS, "tailSeconds": TAIL_SECONDS,
                      "falseRejects": false_rejects,
                      "falseAccepts": false_accepts, "results": results}, ensure_ascii=False, indent=2))
    if false_rejects or false_accepts:
        raise SystemExit("Deployed wake service failed the provisional smoke")


if __name__ == "__main__":
    main()
