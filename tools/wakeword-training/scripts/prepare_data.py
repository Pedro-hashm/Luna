"""Normalize audio and write a reproducible train/validation/test manifest."""

from __future__ import annotations

import argparse
import hashlib
import json
from collections import Counter
from pathlib import Path

import numpy as np

from common import ALLOWED_AUDIO, DATA, ROOT, convert_to_wav, load_config, read_wav, write_json


def file_digest(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def candidate_files() -> list[tuple[Path, str, str]]:
    sources = [
        (DATA / "positive", "positive", "synthetic_or_imported"),
        (DATA / "negative", "negative", "synthetic_or_imported"),
        (DATA / "background", "background", "ambient_recording"),
        (DATA / "recordings" / "positive", "positive", "real_recording"),
        (DATA / "recordings" / "negative", "negative", "real_recording"),
    ]
    found = []
    for directory, label, source_kind in sources:
        if directory.exists():
            found.extend((path, label, source_kind) for path in directory.rglob("*")
                         if path.is_file() and path.suffix.lower() in ALLOWED_AUDIO)
    return sorted(found, key=lambda row: str(row[0]))


def split_for(path: Path, digest: str) -> str:
    # Explicit test folders let users reserve completely unseen real audio.
    for part in path.parts:
        if part in {"train", "validation", "test"}:
            return part
    bucket = int(hashlib.sha256((str(path.relative_to(DATA)) + digest).encode()).hexdigest()[:8], 16) % 10
    return "train" if bucket < 8 else "validation" if bucket == 8 else "test"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path)
    args = parser.parse_args()
    config = load_config(args.config)
    allowed_voices = set(config["kokoro"]["voices"])
    rows = []
    errors = []
    quality_warnings = []
    excluded_files = []
    for source, label, source_kind in candidate_files():
        metadata_path = source.with_suffix(".json")
        metadata = json.loads(metadata_path.read_text(encoding="utf-8")) if metadata_path.exists() else {}
        if metadata.get("source") == "kokoro" and metadata.get("voice") not in allowed_voices:
            excluded_files.append({
                "source": str(source.relative_to(ROOT)).replace("\\", "/"),
                "voice": metadata.get("voice"),
                "reason": "Synthetic voice is outside the configured Brazilian Portuguese allowlist",
            })
            continue
        digest = file_digest(source)
        split = split_for(source, digest)
        target = DATA / "prepared" / split / label / f"{digest[:24]}.wav"
        try:
            if not target.is_file():
                convert_to_wav(source, target)
            samples = read_wav(target)
            if label == "positive" and samples.size > 16000 * 30:
                raise ValueError("Positive clip exceeds 30 seconds; isolate one Luna utterance")
            if label == "negative" and samples.size > 16000 * 600:
                raise ValueError("Negative clip exceeds 10 minutes; put long recordings under background")
            effective_source = (
                "synthetic_kokoro" if metadata.get("source") == "kokoro" else
                ("ambient_recording" if label == "background" else "real_recording")
                if metadata.get("source") == "browser_recording" else
                "synthetic_background" if label == "background" and
                (metadata.get("source") == "synthetic" or source.name.startswith("synthetic_")) else
                source_kind
            )
            if effective_source in {"ambient_recording", "real_recording"}:
                # Windows input devices can yield only +/- one PCM count when
                # muted. Such a clip must not satisfy the real-audio gates.
                peak_pcm = int(np.max(np.abs(samples.astype(np.int32))))
                if peak_pcm <= 2:
                    quality_warnings.append({"source": str(source), "reason": "Digital silence from a muted or disconnected microphone", "peak_pcm": peak_pcm})
                    target.unlink(missing_ok=True)
                    continue
            rows.append({
                "path": str(target.relative_to(ROOT)).replace("\\", "/"),
                "source_path": str(source.relative_to(ROOT)).replace("\\", "/"),
                "sha256": digest,
                "label": label,
                "split": split,
                "source_kind": effective_source,
                "duration_seconds": round(samples.size / 16000, 3),
                "voice": metadata.get("voice"),
                "phrase": metadata.get("phrase"),
            })
        except Exception as exc:
            target.unlink(missing_ok=True)
            errors.append({"source": str(source), "error": str(exc)})
    manifest = DATA / "manifest.jsonl"
    manifest.write_text("".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows), encoding="utf-8")
    counts = Counter((row["split"], row["label"], row["source_kind"]) for row in rows)
    report = {"files": len(rows), "excluded_files": excluded_files,
              "invalid_files": errors, "quality_warnings": quality_warnings,
              "counts": {"/".join(key): value for key, value in sorted(counts.items())}}
    write_json(ROOT / "reports" / "prepare.json", report)
    print(json.dumps(report, ensure_ascii=False, indent=2))
    if errors:
        raise SystemExit("Some audio files were invalid; see reports/prepare.json")


if __name__ == "__main__":
    main()
