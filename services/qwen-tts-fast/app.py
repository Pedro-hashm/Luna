import gc
import io
import logging
import os
import threading
import time
from pathlib import Path

import numpy as np
import soundfile as sf
import torch
from faster_qwen3_tts import FasterQwen3TTS
from fastapi import FastAPI, HTTPException
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel, Field
from starlette.background import BackgroundTask


MODEL_ID = os.getenv("QWEN_TTS_MODEL", "Qwen/Qwen3-TTS-12Hz-0.6B-Base")
REFERENCE_AUDIO = Path(os.getenv("QWEN_REFERENCE_AUDIO", "/reference/Luna-Voice.wav"))
REFERENCE_TEXT = Path(os.getenv("QWEN_REFERENCE_TEXT", "/reference/Luna-Voice.txt"))
IDLE_UNLOAD_SECONDS = int(os.getenv("QWEN_IDLE_UNLOAD_SECONDS", "60"))

app = FastAPI(title="Luna Faster Qwen3-TTS")
logger = logging.getLogger("faster-qwen3-tts")
model: FasterQwen3TTS | None = None
reference_text: str | None = None
last_used_at = 0.0
model_lock = threading.Lock()


class SpeechRequest(BaseModel):
    input: str = Field(min_length=1, max_length=8000)


def load_model() -> tuple[FasterQwen3TTS, str]:
    global model, reference_text, last_used_at
    if model is not None and reference_text is not None:
        last_used_at = time.monotonic()
        return model, reference_text

    if not torch.cuda.is_available():
        raise HTTPException(status_code=503, detail="Faster Qwen3-TTS needs a CUDA GPU in this setup")
    if not REFERENCE_AUDIO.is_file() or not REFERENCE_TEXT.is_file():
        raise HTTPException(status_code=503, detail="Qwen reference audio or transcript is missing")

    try:
        # qwen-tts-hf's Transformers 5.x compatibility helper still reads
        # MimiConfig.rope_theta, while Transformers 5 stores it in
        # MimiConfig.rope_parameters. Expose the legacy attribute expected by
        # that helper using the model's configured value.
        from transformers.models.mimi.configuration_mimi import MimiConfig

        if not hasattr(MimiConfig, "rope_theta"):
            MimiConfig.rope_theta = property(
                lambda config: (config.rope_parameters or {}).get("rope_theta", 10000.0)
            )

        model = FasterQwen3TTS.from_pretrained(
            MODEL_ID,
            device="cuda:0",
            dtype=torch.bfloat16,
        )
        reference_text = REFERENCE_TEXT.read_text(encoding="utf-8").strip()
        if not reference_text:
            raise ValueError("Qwen reference transcript is empty")
        last_used_at = time.monotonic()
        return model, reference_text
    except Exception as error:
        model = None
        reference_text = None
        gc.collect()
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
        raise HTTPException(status_code=503, detail=f"Could not load Faster Qwen3-TTS voice: {error}") from error


@app.get("/healthz")
def health() -> dict[str, object]:
    return {"status": "ok", "model_loaded": model is not None, "model": MODEL_ID, "engine": "faster-qwen3-tts"}


@app.post("/v1/audio/speech")
def synthesize(request: SpeechRequest) -> Response:
    global last_used_at
    with model_lock:
        tts, transcript = load_model()
        try:
            max_new_tokens = min(2048, max(128, len(request.input) * 2 + 64))
            wavs, sample_rate = tts.generate_voice_clone(
                text=request.input,
                language="Portuguese",
                ref_audio=str(REFERENCE_AUDIO),
                ref_text=transcript,
                max_new_tokens=max_new_tokens,
            )
            audio = io.BytesIO()
            sf.write(audio, wavs[0], sample_rate, format="WAV", subtype="PCM_16")
            last_used_at = time.monotonic()
            return Response(content=audio.getvalue(), media_type="audio/wav")
        except Exception as error:
            raise HTTPException(status_code=500, detail=f"Faster Qwen3-TTS synthesis failed: {error}") from error


def audio_to_pcm16(audio: np.ndarray) -> bytes:
    samples = np.asarray(audio, dtype=np.float32).reshape(-1).clip(-1.0, 1.0)
    scaled = np.where(samples < 0, samples * 32768.0, samples * 32767.0)
    return scaled.astype("<i2").tobytes()


@app.post("/v1/audio/speech/stream")
def synthesize_stream(request: SpeechRequest) -> StreamingResponse:
    global last_used_at
    if not model_lock.acquire(timeout=300):
        raise HTTPException(status_code=503, detail="Faster Qwen3-TTS is busy")

    try:
        tts, transcript = load_model()
    except Exception:
        model_lock.release()
        raise

    release_guard = threading.Lock()
    lock_held = True

    def release_model_lock() -> None:
        nonlocal lock_held
        with release_guard:
            if lock_held:
                lock_held = False
                model_lock.release()

    def audio_chunks():
        global last_used_at
        try:
            max_new_tokens = min(2048, max(128, len(request.input) * 2 + 64))
            for audio_chunk, _sample_rate, _timing in tts.generate_voice_clone_streaming(
                text=request.input,
                language="Portuguese",
                ref_audio=str(REFERENCE_AUDIO),
                ref_text=transcript,
                max_new_tokens=max_new_tokens,
                chunk_size=8,
            ):
                pcm_chunk = audio_to_pcm16(audio_chunk)
                if pcm_chunk:
                    last_used_at = time.monotonic()
                    yield pcm_chunk
        except Exception:
            logger.exception("Faster Qwen3-TTS streaming synthesis failed")
            raise
        finally:
            release_model_lock()

    body = audio_chunks()
    return StreamingResponse(
        body,
        media_type="application/octet-stream",
        headers={
            "Cache-Control": "no-store, no-transform",
            "X-Audio-Channels": "1",
            "X-Audio-Encoding": "pcm_s16le",
            "X-Audio-Sample-Rate": str(tts.sample_rate),
            "X-Accel-Buffering": "no",
        },
        background=BackgroundTask(release_model_lock),
    )


def unload_when_idle() -> None:
    global model, reference_text
    while True:
        time.sleep(10)
        if model is None or time.monotonic() - last_used_at < IDLE_UNLOAD_SECONDS:
            continue
        if not model_lock.acquire(blocking=False):
            continue
        try:
            if model is not None and time.monotonic() - last_used_at >= IDLE_UNLOAD_SECONDS:
                model = None
                reference_text = None
                gc.collect()
                if torch.cuda.is_available():
                    torch.cuda.empty_cache()
        finally:
            model_lock.release()


threading.Thread(target=unload_when_idle, daemon=True).start()
