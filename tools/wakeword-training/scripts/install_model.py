"""Promote a trained Luna ONNX artifact to the mounted wake runtime directory."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import tempfile
from pathlib import Path

import requests

from common import REPO, ROOT, write_json


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", type=Path, default=ROOT / "models" / "luna.onnx")
    parser.add_argument("--verifier", action="store_true")
    parser.add_argument("--allow-unvalidated", action="store_true",
                        help="Install a provisional model before real-audio evaluation; never call it production-ready")
    parser.add_argument("--reload-url", default=os.getenv("WAKEWORD_BASE_URL", "http://localhost:8765"))
    args = parser.parse_args()
    report_path = ROOT / "reports" / "evaluation.json"
    report = json.loads(report_path.read_text(encoding="utf-8")) if report_path.is_file() else {}
    model_sha = hashlib.sha256(args.model.read_bytes()).hexdigest() if args.model.is_file() else None
    validated = bool(report.get("deployment_pass") and report.get("model_sha256") == model_sha)
    if not validated and not args.allow_unvalidated:
        raise SystemExit("Real-audio evaluation has not passed; run evaluate.py or explicitly use --allow-unvalidated")
    if not args.model.is_file():
        raise SystemExit(f"Missing trained model: {args.model}")
    import onnx
    model = onnx.load(str(args.model))
    onnx.checker.check_model(model)
    target_dir = REPO / "services" / "wakeword" / "models"
    target_dir.mkdir(parents=True, exist_ok=True)
    target = target_dir / "luna.onnx"
    with tempfile.NamedTemporaryFile(dir=target_dir, suffix=".onnx", delete=False) as temp:
        temp_path = Path(temp.name)
    try:
        shutil.copyfile(args.model, temp_path)
        temp_path.replace(target)
    finally:
        temp_path.unlink(missing_ok=True)
    write_json(target.with_suffix(".metadata.json"), {
        "state": "validated" if validated else "provisional",
        "sha256": model_sha,
        "evaluation": {
            "threshold": report.get("threshold"),
            "recall": report.get("recall"),
            "false_accepts_per_hour": report.get("false_accepts_per_hour"),
            "background_false_accepts_per_hour": report.get("background_false_accepts_per_hour"),
            "real_positive_count": report.get("real_positive_count"),
            "background_hours": report.get("background_hours"),
            "sufficient_real_data": report.get("sufficient_real_data", False),
        },
    })
    if args.verifier:
        source = ROOT / "models" / "luna_verifier.pkl"
        if not source.is_file():
            raise SystemExit("Verifier requested but not trained")
        shutil.copyfile(source, target_dir / source.name)
        print("Set WAKE_VERIFIER_PATH=/app/models/luna_verifier.pkl to enable after evaluation")
    print(f"Installed {target} ({'validated' if validated else 'PROVISIONAL'})")
    try:
        response = requests.post(args.reload_url.rstrip("/") + "/reload", timeout=30)
        response.raise_for_status()
        print(f"Wake service reloaded: {response.json()}")
    except requests.RequestException as exc:
        print(f"Wake service not reloaded ({exc}); POST /reload after starting it")


if __name__ == "__main__":
    main()
