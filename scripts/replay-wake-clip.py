"""Replay a mono 16 kHz WAV through the deployed wake HTTP endpoint.

Example inside wake container: python /tmp/replay-wake-clip.py /tmp/captured.wav
"""

import json
import sys
import wave
from urllib.request import Request, urlopen


def post(path, payload, session="wake-replay"):
    req = Request(f"http://127.0.0.1:8765{path}", data=payload,
                  headers={"x-voice-session-id": session}, method="POST")
    with urlopen(req, timeout=10) as response:
        return json.load(response)


def main():
    with wave.open(sys.argv[1], "rb") as source:
        assert (source.getnchannels(), source.getframerate(), source.getsampwidth()) == (1, 16000, 2)
        pcm = source.readframes(source.getnframes())
    frame_bytes = int(sys.argv[2]) if len(sys.argv) > 2 else 10240
    scores = []
    post("/reset", b"")
    try:
        for start in range(0, len(pcm), frame_bytes):
            frame = pcm[start:start + frame_bytes]
            if len(frame) < frame_bytes:
                frame = frame.ljust(frame_bytes, b"\0")
            result = post("/detect?threshold=0.97", frame)
            scores.append(round(result["score"], 5))
        print(json.dumps({"frames": len(scores), "maxScore": max(scores, default=0),
                          "detected": any(score >= 0.97 for score in scores), "scores": scores}))
    finally:
        post("/reset", b"")


if __name__ == "__main__":
    main()
