"""Fit a Kokoro voice pack from one clean reference recording."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
from importlib.metadata import version
from pathlib import Path

import torch
from huggingface_hub import hf_hub_download
from inno_kokoro.enroll import Tuner, enroll, read


VOICE_ID = re.compile(r"^p[fm]_[A-Za-z0-9_-]{1,80}$")


def arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Create a Brazilian Portuguese Kokoro .pt pack from reference speech."
    )
    parser.add_argument("--input", required=True, type=Path, help="Reference audio (WAV, FLAC, OGG, or MP3).")
    parser.add_argument("--output", required=True, type=Path, help="Destination .pt file, named to match --voice-id.")
    parser.add_argument("--voice-id", required=True, help="Kokoro ID, for example pf_luna_user or pm_luna_user.")
    parser.add_argument("--device", choices=("auto", "cpu", "cuda"), default="auto")
    return parser.parse_args()


def main() -> int:
    args = arguments()
    voice_id = args.voice_id.strip()
    if not VOICE_ID.fullmatch(voice_id):
        raise SystemExit("--voice-id must start with pf_ or pm_ and contain only letters, digits, _ or -")
    output = args.output
    if output.suffix.lower() != ".pt" or output.name != f"{voice_id}.pt":
        raise SystemExit("--output must be named exactly <voice-id>.pt")
    if not args.input.is_file():
        raise SystemExit(f"Reference audio not found: {args.input}")

    if args.device == "cuda" and not torch.cuda.is_available():
        raise SystemExit("CUDA was requested but no NVIDIA GPU is available in this container")
    device = "cuda" if args.device == "cuda" or (args.device == "auto" and torch.cuda.is_available()) else "cpu"
    if device == "cuda":
        torch.cuda.set_device(0)
    torch.set_num_threads(min(8, os.cpu_count() or 1))

    waveform, sample_rate = read(str(args.input))
    duration = waveform.numel() / sample_rate
    if duration < 3 or duration > 30:
        raise SystemExit(f"Reference audio must be 3 to 30 seconds; received {duration:.2f} seconds")
    if waveform.ndim != 1 or not torch.isfinite(waveform).all():
        raise SystemExit("Reference audio must decode to finite mono speech")

    # Enrollment fits a stock-shaped tensor; it does not update Kokoro's weights.
    tuner = Tuner(device=device)
    pack, blend_weights = enroll(waveform, sample_rate, tuner)
    if tuple(pack.shape) != (510, 1, 256):
        raise RuntimeError(f"Unexpected Kokoro pack shape: {tuple(pack.shape)}")

    # The tuner's prosody blends are English-only. Keep its reference speaker
    # timbre, but take the predictor half from a native Brazilian Portuguese
    # Kokoro pack so the output cadence stays in the requested language.
    prosody_base = "pf_dora" if voice_id.startswith("pf_") else "pm_alex"
    prosody_path = hf_hub_download("hexgrad/Kokoro-82M", f"voices/{prosody_base}.pt")
    portuguese_pack = torch.load(prosody_path, map_location="cpu", weights_only=True)
    if not isinstance(portuguese_pack, torch.Tensor) or tuple(portuguese_pack.shape) != (510, 1, 256):
        raise RuntimeError(f"Unexpected Portuguese base pack shape for {prosody_base}")
    pack = pack.cpu().contiguous()
    pack[:, :, 128:] = portuguese_pack[:, :, 128:].to(dtype=pack.dtype)

    output.parent.mkdir(parents=True, exist_ok=True)
    temp_path = output.with_name(f".{output.name}.tmp")
    try:
        torch.save(pack.cpu().contiguous(), temp_path)
        checked = torch.load(temp_path, map_location="cpu", weights_only=True)
        if not isinstance(checked, torch.Tensor) or tuple(checked.shape) != (510, 1, 256):
            raise RuntimeError("The saved file did not reload as a compatible Kokoro voice tensor")
        temp_path.replace(output)
    finally:
        temp_path.unlink(missing_ok=True)

    checksum = hashlib.sha256(output.read_bytes()).hexdigest()
    metadata = {
        "voiceId": voice_id,
        "languageCode": "p",
        "format": "kokoro-voice-tensor-v1",
        "tuner": f"inno-kokoro {version('inno-kokoro')}",
        "portugueseProsodyBase": prosody_base,
        "device": device,
        "referenceDurationSeconds": round(duration, 3),
        "referenceSampleRate": sample_rate,
        "referenceBlendWeights": blend_weights,
        "packSha256": checksum,
        "note": "Portuguese prosody comes from the selected native Kokoro pack; speaker-timbre enrollment remains experimental because the upstream tuner is documented for English.",
    }
    output.with_suffix(".json").write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(json.dumps({**metadata, "output": str(output), "bytes": output.stat().st_size}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"Voice pack creation failed: {exc}", file=sys.stderr)
        raise
