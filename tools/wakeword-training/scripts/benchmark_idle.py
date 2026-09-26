"""Send 80-ms silent frames for 10/30/60 minutes and record wake idle metrics.

This is a repeatable service-only baseline. Run the browser/API idle test too,
and inspect API observability to confirm no STT/LLM/TTS/search requests.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import time
import uuid
from pathlib import Path

import requests

from common import ROOT, write_json


def docker_stats(container: str) -> dict | None:
    try:
        result = subprocess.run(
            ["docker", "stats", "--no-stream", "--format", "{{json .}}", container],
            capture_output=True, text=True, check=True, timeout=10,
        )
        return json.loads(result.stdout.strip())
    except (OSError, subprocess.SubprocessError, json.JSONDecodeError):
        return None


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--minutes", type=float, choices=[10.0, 30.0, 60.0], default=10.0)
    parser.add_argument("--base-url", default=os.getenv("WAKEWORD_BASE_URL", "http://127.0.0.1:8765"))
    parser.add_argument("--container", default="luna-v2-wakeword")
    args = parser.parse_args()
    if not requests.get(args.base_url.rstrip("/") + "/health", timeout=5).ok:
        raise SystemExit("Wake service is not ready; install luna.onnx first")
    session_id = "idle-benchmark-" + uuid.uuid4().hex
    headers = {"Content-Type": "application/octet-stream", "X-Voice-Session-Id": session_id}
    silence = bytes(1280 * 2)
    interval = 0.08
    start = time.monotonic()
    end = start + args.minutes * 60
    next_frame = start
    latencies = []
    false_wakes = 0
    docker_samples = []
    last_stats = start - 30
    while time.monotonic() < end:
        now = time.monotonic()
        if now < next_frame:
            time.sleep(min(next_frame - now, 0.08))
            continue
        began = time.monotonic()
        response = requests.post(args.base_url.rstrip("/") + "/detect", data=silence,
                                 headers=headers, timeout=5)
        response.raise_for_status()
        data = response.json()
        false_wakes += bool(data["detected"])
        latencies.append((time.monotonic() - began) * 1000)
        next_frame += interval
        if now - last_stats >= 30:
            sample = docker_stats(args.container)
            if sample:
                docker_samples.append({"seconds": round(now - start, 1), **sample})
            last_stats = now
    requests.post(args.base_url.rstrip("/") + "/reset", headers=headers, timeout=5)
    elapsed = time.monotonic() - start
    latencies.sort()
    result = {
        "duration_seconds": round(elapsed, 2),
        "requests": len(latencies),
        "false_wakes": false_wakes,
        "request_latency_ms_median": latencies[len(latencies) // 2] if latencies else None,
        "request_latency_ms_p95": latencies[min(len(latencies)-1, int(len(latencies)*0.95))] if latencies else None,
        "docker_stats": docker_samples,
        "note": "Service-only silent-frame baseline. Separately confirm browser/API idle sends no STT, LLM, TTS or search requests.",
    }
    target = ROOT / "reports" / f"idle-{int(args.minutes)}min.json"
    write_json(target, result)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
