"""Create a subtle Brazilian Portuguese Kokoro voice variation from stock packs."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import torch
from huggingface_hub import hf_hub_download


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dora", type=Path, help="Native Brazilian Portuguese pf_dora.pt pack; downloaded if omitted")
    parser.add_argument("--inspiration", type=Path, help="Female timbre pack to blend in; if_sara.pt is downloaded if omitted")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--voice-id", default="pf_luna_nobre")
    parser.add_argument("--timbre-weight", type=float, default=0.12, help="Inspiration contribution from 0 to 0.25")
    args = parser.parse_args()

    if not args.voice_id.startswith("pf_") or not args.voice_id.replace("_", "").isalnum():
        parser.error("--voice-id must be a safe pf_ Portuguese female voice id")
    if not 0.0 <= args.timbre_weight <= 0.25:
        parser.error("--timbre-weight must be between 0 and 0.25 to keep the result close to Dora")
    if args.output.suffix.lower() != ".pt" or args.output.name != f"{args.voice_id}.pt":
        parser.error("--output must be named exactly <voice-id>.pt")

    dora_path = args.dora or Path(hf_hub_download("hexgrad/Kokoro-82M", "voices/pf_dora.pt"))
    inspiration_path = args.inspiration or Path(hf_hub_download("hexgrad/Kokoro-82M", "voices/if_sara.pt"))
    dora = torch.load(dora_path, map_location="cpu", weights_only=True)
    inspiration = torch.load(inspiration_path, map_location="cpu", weights_only=True)
    expected_shape = (510, 1, 256)
    if not isinstance(dora, torch.Tensor) or tuple(dora.shape) != expected_shape:
        raise ValueError(f"Unexpected Brazilian Portuguese voice pack shape: {getattr(dora, 'shape', None)}")
    if not isinstance(inspiration, torch.Tensor) or tuple(inspiration.shape) != expected_shape:
        raise ValueError(f"Unexpected inspiration voice pack shape: {getattr(inspiration, 'shape', None)}")
    if not torch.isfinite(dora).all() or not torch.isfinite(inspiration).all():
        raise ValueError("Voice packs must contain finite values")

    # The first 128 dimensions carry the speaker timbre. Keep all Portuguese
    # pronunciation/prosody values from Dora and only add a restrained amount
    # of a brighter female timbre.
    pack = dora.contiguous().clone()
    weight = args.timbre_weight
    pack[:, :, :128] = ((1.0 - weight) * dora[:, :, :128] + weight * inspiration[:, :, :128]).to(pack.dtype)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    temp_path = args.output.with_name(f".{args.output.name}.tmp")
    try:
        torch.save(pack.contiguous(), temp_path)
        check = torch.load(temp_path, map_location="cpu", weights_only=True)
        if not isinstance(check, torch.Tensor) or tuple(check.shape) != expected_shape:
            raise RuntimeError("Generated pack failed its compatibility check")
        temp_path.replace(args.output)
    finally:
        temp_path.unlink(missing_ok=True)

    digest = hashlib.sha256(args.output.read_bytes()).hexdigest()
    metadata = {
        "voiceId": args.voice_id,
        "languageCode": "p",
        "format": "kokoro-voice-tensor-v1",
        "baseVoice": "pf_dora",
        "timbreInspiration": inspiration_path.stem,
        "timbreWeight": weight,
        "prosodySource": "pf_dora",
        "packSha256": digest,
        "note": "A light female timbre blend; Brazilian Portuguese cadence and pronunciation remain from pf_dora. Kokoro does not accept natural-language emotion prompts, so the aristocratic delivery is approximated with a subtle timbre shift and a small per-profile speed reduction in Luna.",
    }
    args.output.with_suffix(".json").write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({**metadata, "output": str(args.output), "bytes": args.output.stat().st_size}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
