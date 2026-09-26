"""Measure an open Wake/Idle voice session without sending speech.

Example: python scripts/benchmark-voice-idle.py --session-id UUID \
    --duration-seconds 600 --output reports/voice-idle-10m.json

Run 600, 1800 and 3600 seconds for the requested 10/30/60 minute windows.
The browser must remain open in Wake mode for the entire run.
"""

import argparse
import json
import statistics
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import urlopen


CONTAINERS = [
    "luna-v2-web",
    "luna-v2-api",
    "luna-v2-wakeword",
    "luna-v2-speaches",
    "luna-v2-kokoro",
]


def command(*args: str) -> str:
    result = subprocess.run(args, check=True, capture_output=True, text=True)
    return result.stdout.strip()


def db_counts() -> dict[str, int]:
    query = (
        "SELECT "
        "(SELECT count(*) FROM observability_traces),"
        "(SELECT count(*) FROM research_runs),"
        "(SELECT count(*) FROM voice_events WHERE type='voice.stt.started'),"
        "(SELECT count(*) FROM voice_events WHERE type='voice.tts.started'),"
        "(SELECT count(*) FROM voice_events WHERE type='voice.thinking.started');"
    )
    values = command(
        "docker", "exec", "luna-v2-postgres", "psql", "-At", "-U", "luna", "-d", "luna", "-c", query,
    ).split("|")
    return dict(zip(("llmOrToolTraces", "researchRuns", "sttStarts", "ttsStarts", "thinkingStarts"), map(int, values)))


def voice_state(api_url: str, session_id: str) -> dict:
    with urlopen(f"{api_url.rstrip('/')}/voice/sessions/{session_id}/events", timeout=5) as response:
        return json.load(response)["session"]


def snapshot() -> dict:
    result: dict = {"time": datetime.now(timezone.utc).isoformat()}
    raw = command("docker", "stats", "--no-stream", "--format", "{{json .}}", *CONTAINERS)
    result["containers"] = [json.loads(line) for line in raw.splitlines() if line.strip()]
    try:
        gpu = command("nvidia-smi", "--query-gpu=utilization.gpu,memory.used", "--format=csv,noheader,nounits")
        result["gpu"] = [list(map(float, line.split(","))) for line in gpu.splitlines()]
    except (subprocess.CalledProcessError, FileNotFoundError):
        result["gpu"] = None
    return result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--session-id", required=True)
    parser.add_argument("--duration-seconds", type=int, choices=(600, 1800, 3600), required=True)
    parser.add_argument("--interval-seconds", type=int, default=15)
    parser.add_argument("--api-url", default="http://localhost:8000")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    before_state = voice_state(args.api_url, args.session_id)
    if before_state.get("mode") != "wake" or before_state.get("state") != "idle":
        raise SystemExit("Session must be in Wake/Idle before measuring")
    before = db_counts()
    started = time.monotonic()
    samples = []
    invalid_states = []
    while time.monotonic() - started < args.duration_seconds:
        sample = snapshot()
        state = voice_state(args.api_url, args.session_id)
        sample["voiceState"] = state.get("state")
        if state.get("mode") != "wake" or state.get("state") != "idle":
            invalid_states.append({"time": sample["time"], "mode": state.get("mode"), "state": state.get("state")})
        samples.append(sample)
        time.sleep(min(args.interval_seconds, max(0, args.duration_seconds - (time.monotonic() - started))))

    after = db_counts()
    changes = {key: after[key] - before[key] for key in before}
    gpu_util = [gpu[0] for item in samples if item["gpu"] for gpu in item["gpu"]]
    report = {
        "startedAt": samples[0]["time"] if samples else None,
        "finishedAt": datetime.now(timezone.utc).isoformat(),
        "durationSeconds": round(time.monotonic() - started, 1),
        "sessionId": args.session_id,
        "samples": samples,
        "databaseChanges": changes,
        "invalidStates": invalid_states,
        "gpuUtilizationPercentMean": round(statistics.mean(gpu_util), 2) if gpu_util else None,
        "passesNoDownstreamCalls": not invalid_states and all(value == 0 for value in changes.values()),
        "note": "GPU utilization is system-wide and can include unrelated workloads; container CPU/memory/network are per-container.",
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({key: report[key] for key in ("durationSeconds", "databaseChanges", "invalidStates", "passesNoDownstreamCalls")}, ensure_ascii=False))


if __name__ == "__main__":
    main()
