"""Train optional user-specific openWakeWord verifier from real recordings."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from common import DATA, ROOT, load_config


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path)
    parser.add_argument("--model", type=Path, default=ROOT / "models" / "luna.onnx")
    args = parser.parse_args()
    load_config(args.config)
    if not args.model.is_file():
        raise SystemExit(f"Train luna.onnx first: {args.model}")
    rows = [json.loads(line) for line in (DATA / "manifest.jsonl").read_text(encoding="utf-8").splitlines() if line]
    positives = [str(ROOT / row["path"]) for row in rows if row["split"] == "train" and
                 row["label"] == "positive" and row["source_kind"] == "real_recording"]
    negatives = [str(ROOT / row["path"]) for row in rows if row["split"] == "train" and
                 row["label"] == "negative" and row["source_kind"] == "real_recording"]
    if len(positives) < 3 or not negatives:
        raise SystemExit("Verifier needs at least 3 real Luna clips and normal-speech negatives in recordings/train")
    from openwakeword import train_custom_verifier
    output = ROOT / "models" / "luna_verifier.pkl"
    train_custom_verifier(positive_reference_clips=positives,
                          negative_reference_clips=negatives,
                          output_path=str(output), model_name=str(args.model),
                          inference_framework="onnx")
    print(f"Verifier saved to {output}; evaluate it before enabling")


if __name__ == "__main__":
    main()
