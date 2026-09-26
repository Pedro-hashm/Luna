import gc
import io
import os
import threading
import time
from pathlib import Path

import soundfile as sf
import torch
from fastapi import FastAPI, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field
from qwen_tts import Qwen3TTSModel


MODEL_ID = os.getenv("QWEN_TTS_MODEL", "Qwen/Qwen3-TTS-12Hz-0.6B-Base")
REFERENCE_AUDIO = Path(os.getenv("QWEN_REFERENCE_AUDIO", "/reference/Luna-Voice.mp3"))
REFERENCE_TEXT = Path(os.getenv("QWEN_REFERENCE_TEXT", "/reference/Luna-Voice.txt"))
IDLE_UNLOAD_SECONDS = int(os.getenv("QWEN_IDLE_UNLOAD_SECONDS", "300"))

app = FastAPI(title="Luna Qwen3-TTS")
model: Qwen3TTSModel | None = None
clone_prompt = None
last_used_at = 0.0
model_lock = threading.Lock()


class SpeechRequest(BaseModel):
    input: str = Field(min_length=1, max_length=8000)


def load_model() -> tuple[Qwen3TTSModel, object]:
    global model, clone_prompt, last_used_at
    if model is not None and clone_prompt is not None:
        last_used_at = time.monotonic()
        return model, clone_prompt

    if not torch.cuda.is_available():
        raise HTTPException(status_code=503, detail="Qwen3-TTS needs a CUDA GPU in this setup")
    if not REFERENCE_AUDIO.is_file() or not REFERENCE_TEXT.is_file():
        raise HTTPException(status_code=503, detail="Qwen reference audio or transcript is missing")

    try:
        model = Qwen3TTSModel.from_pretrained(
            MODEL_ID,
            device_map="cuda:0",
            dtype=torch.bfloat16,
        )
        reference_text = REFERENCE_TEXT.read_text(encoding="utf-8").strip()
        clone_prompt = model.create_voice_clone_prompt(
            ref_audio=str(REFERENCE_AUDIO),
            ref_text=reference_text,
        )
        last_used_at = time.monotonic()
        return model, clone_prompt
    except HTTPException:
        raise
    except Exception as error:
        model = None
        clone_prompt = None
        gc.collect()
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
        raise HTTPException(status_code=503, detail=f"Could not load Qwen3-TTS voice: {error}") from error


@app.get("/healthz")
def health() -> dict[str, object]:
    return {"status": "ok", "model_loaded": model is not None, "model": MODEL_ID}


@app.post("/v1/audio/speech")
def synthesize(request: SpeechRequest) -> Response:
    global last_used_at
    with model_lock:
        tts, prompt = load_model()
        try:
            max_new_tokens = min(2048, max(128, len(request.input) * 2 + 64))
            wavs, sample_rate = tts.generate_voice_clone(
                text=request.input,
                language="Portuguese",
                voice_clone_prompt=prompt,
                max_new_tokens=max_new_tokens,
            )
            audio = io.BytesIO()
            sf.write(audio, wavs[0], sample_rate, format="WAV", subtype="PCM_16")
            last_used_at = time.monotonic()
            return Response(content=audio.getvalue(), media_type="audio/wav")
        except HTTPException:
            raise
        except Exception as error:
            raise HTTPException(status_code=500, detail=f"Qwen3-TTS synthesis failed: {error}") from error


def unload_when_idle() -> None:
    global model, clone_prompt
    while True:
        time.sleep(10)
        if model is None or time.monotonic() - last_used_at < IDLE_UNLOAD_SECONDS:
            continue
        if not model_lock.acquire(blocking=False):
            continue
        try:
            if model is not None and time.monotonic() - last_used_at >= IDLE_UNLOAD_SECONDS:
                model = None
                clone_prompt = None
                gc.collect()
                if torch.cuda.is_available():
                    torch.cuda.empty_cache()
        finally:
            model_lock.release()


threading.Thread(target=unload_when_idle, daemon=True).start()
