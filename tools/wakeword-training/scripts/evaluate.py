"""Evaluate streaming Luna detection on held-out positive and continuous negative audio."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import statistics
from collections import deque
from pathlib import Path

import numpy as np

from common import DATA, ROOT, load_config, read_wav, write_json


FRAME = 1280  # 80 ms at 16 kHz


def stream_events(model, samples: np.ndarray, threshold: float, cooldown_seconds: float) -> list[tuple[int, float]]:
    model.reset()
    events = []
    last_event = -10**9
    quiet_frames = deque(maxlen=6)
    speaking = False
    quiet_hangover = 0
    for offset in range(0, samples.size, FRAME):
        frame = samples[offset:offset + FRAME]
        if frame.size < FRAME:
            frame = np.pad(frame, (0, FRAME - frame.size))
        rms = float(np.sqrt(np.mean(np.square(frame.astype(np.float32))))) / 32768
        if rms < 0.003:
            if speaking and quiet_hangover < 2:
                quiet_hangover += 1
            else:
                if speaking:
                    model.reset()
                    speaking = False
                quiet_frames.append(frame.copy())
                continue
        else:
            if not speaking and quiet_frames:
                frame = np.concatenate((*quiet_frames, frame))
            quiet_frames.clear()
            speaking = True
            quiet_hangover = 0
        score = float(model.predict(frame)["luna"])
        if score >= threshold and (offset - last_event) / 16000 >= cooldown_seconds:
            events.append((offset + FRAME, score))
            last_event = offset + FRAME
    return events


def positive_result(model, samples: np.ndarray, threshold: float, cooldown_seconds: float) -> dict:
    # An approximate speech interval from amplitude; use annotated labels when available.
    active = np.flatnonzero(np.abs(samples.astype(np.float32)) / 32768 > 0.004)
    if active.size == 0:
        return {"detected": False, "latency_ms": None, "score": 0, "error": "no speech energy"}
    lead = 16000
    padded = np.concatenate((np.zeros(lead, dtype=np.int16), samples, np.zeros(16000, dtype=np.int16)))
    events = stream_events(model, padded, threshold, cooldown_seconds)
    speech_start = lead + int(active[0])
    speech_end = lead + int(active[-1])
    valid = [(sample, score) for sample, score in events if sample >= speech_start - 3200]
    if not valid:
        return {"detected": False, "latency_ms": None, "score": max((score for _, score in events), default=0)}
    detected_sample, score = valid[0]
    return {"detected": True,
            "latency_ms": round((detected_sample - speech_end) / 16, 1),
            "score": score}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path)
    parser.add_argument("--model", type=Path, default=ROOT / "models" / "luna.onnx")
    parser.add_argument("--threshold", type=float)
    parser.add_argument("--verifier", action="store_true", help="Evaluate with the user-specific verifier")
    parser.add_argument("--verifier-threshold", type=float, default=0.5,
                        help="Base-model score that activates the verifier")
    args = parser.parse_args()
    config = load_config(args.config)
    evaluation = config["evaluation"]
    threshold = args.threshold if args.threshold is not None else float(evaluation["threshold"])
    if not 0 <= threshold <= 1:
        parser.error("threshold must be between 0 and 1")
    if not 0 <= args.verifier_threshold <= 1:
        parser.error("verifier-threshold must be between 0 and 1")
    if not args.model.is_file():
        raise SystemExit(f"Model not found: {args.model}")
    manifest = DATA / "manifest.jsonl"
    if not manifest.exists():
        raise SystemExit("Run prepare_data.py before evaluating")
    rows = [json.loads(line) for line in manifest.read_text(encoding="utf-8").splitlines() if line]
    test_rows = [row for row in rows if row["split"] == "test"]
    from openwakeword.model import Model
    verifier_path = ROOT / "models" / "luna_verifier.pkl"
    if args.verifier and not verifier_path.is_file():
        raise SystemExit(f"Verifier not found: {verifier_path}; train it first")
    model_options = {}
    if args.verifier:
        model_options = {
            "custom_verifier_models": {"luna": str(verifier_path)},
            "custom_verifier_threshold": args.verifier_threshold,
        }
    model = Model(wakeword_models=[str(args.model)], inference_framework="onnx", vad_threshold=0,
                  **model_options)
    positives = []
    negatives = []
    background = []
    cooldown = float(evaluation["cooldown_seconds"])
    for row in test_rows:
        samples = read_wav(ROOT / row["path"])
        if row["label"] == "positive":
            result = positive_result(model, samples, threshold, cooldown)
            positives.append({"file": row["source_path"], "real": row["source_kind"] == "real_recording", **result})
        elif row["label"] == "background":
            events = stream_events(model, samples, threshold, cooldown)
            detail = {"file": row["source_path"], "real": row["source_kind"] == "ambient_recording",
                      "hours": samples.size / 16000 / 3600,
                      "false_accepts": len(events), "scores": [score for _, score in events]}
            background.append(detail)
        else:
            padded = np.concatenate((np.zeros(16000, dtype=np.int16), samples,
                                     np.zeros(16000, dtype=np.int16)))
            events = stream_events(model, padded, threshold, cooldown)
            detail = {"file": row["source_path"], "real": row["source_kind"] == "real_recording",
                      "hours": samples.size / 16000 / 3600,
                      "false_accepts": len(events), "scores": [score for _, score in events]}
            negatives.append(detail)
    total_hours = sum(row["hours"] for row in background + negatives)
    background_hours = sum(row["hours"] for row in background if row["real"])
    false_accepts = sum(row["false_accepts"] for row in background + negatives)
    background_false_accepts = sum(row["false_accepts"] for row in background if row["real"])
    false_rejects = sum(not row["detected"] for row in positives)
    real_positive_count = sum(row["real"] for row in positives)
    latencies = sorted(row["latency_ms"] for row in positives if row["latency_ms"] is not None)
    sufficient_real_data = (real_positive_count >= config["train"]["min_positive_test_real"]
                            and background_hours >= config["train"]["min_background_test_hours"])
    report = {
        "model": str(args.model), "threshold": threshold,
        "verifier": {"enabled": args.verifier,
                     "threshold": args.verifier_threshold if args.verifier else None},
        "model_sha256": hashlib.sha256(args.model.read_bytes()).hexdigest(),
        "positive_count": len(positives), "real_positive_count": real_positive_count,
        "recall": (len(positives) - false_rejects) / len(positives) if positives else None,
        "false_rejects": false_rejects,
        "false_accepts": false_accepts,
        "all_negative_hours": round(total_hours, 4),
        "false_accepts_per_hour": false_accepts / total_hours if total_hours else None,
        "background_false_accepts": background_false_accepts,
        "background_hours": round(background_hours, 4),
        "background_false_accepts_per_hour": background_false_accepts / background_hours if background_hours else None,
        "detection_latency_ms_median": statistics.median(latencies) if latencies else None,
        "detection_latency_ms_p95": latencies[min(len(latencies) - 1, math.ceil(0.95 * len(latencies)) - 1)] if latencies else None,
        "latency_definition": "Detection time minus amplitude-estimated end of speech; this is an approximation, not annotated latency.",
        "sufficient_real_data": sufficient_real_data,
        "deployment_pass": bool(sufficient_real_data and positives and background_hours and
                                (len(positives) - false_rejects) / len(positives) >= evaluation["target_recall"] and
                                background_false_accepts / background_hours <= evaluation["target_false_accepts_per_hour"]),
        "positives": positives, "negative_files": negatives, "background_files": background,
    }
    write_json(ROOT / "reports" / "evaluation.json", report)
    lines = [
        "# Luna wake word evaluation", "", f"Model: `{args.model}`", f"Threshold: {threshold}",
        f"Verifier: {'enabled at ' + str(args.verifier_threshold) if args.verifier else 'disabled'}",
        f"Recall: {report['recall'] if report['recall'] is not None else 'N/A'}",
        f"False rejects: {false_rejects}/{len(positives)}",
        f"False accepts: {false_accepts} across {total_hours:.2f} hours",
        f"False accepts/hour (all negative): {report['false_accepts_per_hour'] if total_hours else 'N/A'}",
        f"False accepts/hour (real background): {report['background_false_accepts_per_hour'] if background_hours else 'N/A'}",
        f"Detection latency median / p95 (approximate, ms): {report['detection_latency_ms_median']} / {report['detection_latency_ms_p95']}",
        f"Real positive clips: {real_positive_count}", f"Held-out background hours: {background_hours:.2f}",
        f"Sufficient real data: {sufficient_real_data}", f"Deployment criteria passed: {report['deployment_pass']}",
        "", "Synthetic-only evaluation is not evidence of real wake reliability.",
        "Latency uses amplitude-estimated speech end; annotate utterances for precise latency.",
    ]
    (ROOT / "reports" / "evaluation.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("\n".join(lines))


if __name__ == "__main__":
    main()
