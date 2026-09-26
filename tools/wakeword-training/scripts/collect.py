"""Record real wake, negative speech, or hours of background audio."""

from __future__ import annotations

import argparse
import datetime as dt
import time
import wave
from pathlib import Path

import sounddevice as sd

from common import DATA


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--kind", choices=["positive", "negative", "background"], required=True)
    parser.add_argument("--split", choices=["train", "validation", "test"], default="train")
    parser.add_argument("--seconds", type=float, help="Stop automatically after this duration; Ctrl+C also stops")
    parser.add_argument("--device", help="sounddevice input device name or ID")
    args = parser.parse_args()
    if args.seconds is not None and args.seconds <= 0:
        parser.error("seconds must be positive")
    directory = DATA / "background" / args.split if args.kind == "background" else DATA / "recordings" / args.kind / args.split
    directory.mkdir(parents=True, exist_ok=True)
    stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    filename = directory / f"{args.kind}-{stamp}.wav"
    print(f"Recording {args.kind} at 16 kHz mono. Press Ctrl+C to stop.")
    frames = 0
    start = time.monotonic()
    try:
        with wave.open(str(filename), "wb") as wav:
            wav.setnchannels(1)
            wav.setsampwidth(2)
            wav.setframerate(16000)
            with sd.InputStream(samplerate=16000, channels=1, dtype="int16", device=args.device) as stream:
                while args.seconds is None or time.monotonic() - start < args.seconds:
                    block, overflowed = stream.read(1600)
                    if overflowed:
                        print("Warning: microphone overflow; consider a less busy device")
                    wav.writeframes(block.tobytes())
                    frames += len(block)
    except KeyboardInterrupt:
        pass
    if not frames:
        filename.unlink(missing_ok=True)
        raise SystemExit("No audio captured")
    print(f"Saved {filename} ({frames / 16000:.1f}s)")


if __name__ == "__main__":
    main()
