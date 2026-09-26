"""Exercise the live Kokoro and Speaches services on the Compose network.

Run with ``docker cp scripts/smoke-voice-providers.py luna-v2-speaches:/tmp/``
then ``docker exec luna-v2-speaches python /tmp/smoke-voice-providers.py``.
"""

import json
import uuid
from urllib.request import Request, urlopen


KOKORO = "http://kokoro:8000"
SPEACHES = "http://127.0.0.1:8000"
MODEL = "Systran/faster-whisper-small"


def post_json(url: str, payload: dict) -> bytes:
    request = Request(
        url,
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
    )
    with urlopen(request, timeout=120) as response:
        if response.status != 200:
            raise RuntimeError(f"{url}: HTTP {response.status}")
        return response.read()


def main() -> None:
    phrase = "Olá, eu sou a Luna. A capital da Austrália é Canberra."
    with urlopen(f"{KOKORO}/v1/audio/voices", timeout=10) as response:
        voices = json.load(response)["voices"]
    assert any(voice["id"] == "pf_dora" for voice in voices)

    wav = post_json(
        f"{KOKORO}/v1/audio/speech",
        {
            "model": "kokoro",
            "input": phrase,
            "voice": "pf_dora",
            "response_format": "wav",
        },
    )
    assert wav[:4] == b"RIFF" and len(wav) > 1000

    boundary = f"voice-smoke-{uuid.uuid4().hex}"
    body = bytearray()
    for name, value in (("model", MODEL), ("language", "pt")):
        body += f"--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n{value}\r\n".encode()
    body += f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"sample.wav\"\r\nContent-Type: audio/wav\r\n\r\n".encode()
    body += wav
    body += f"\r\n--{boundary}--\r\n".encode()
    request = Request(
        f"{SPEACHES}/v1/audio/transcriptions",
        data=bytes(body),
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
    )
    with urlopen(request, timeout=180) as response:
        transcription = json.load(response)
    text = transcription.get("text", "")
    if not text.strip():
        raise RuntimeError(f"Speaches returned an empty transcript: {transcription}")
    print(json.dumps({"voices": len(voices), "wavBytes": len(wav), "transcript": text}, ensure_ascii=False))


if __name__ == "__main__":
    main()
