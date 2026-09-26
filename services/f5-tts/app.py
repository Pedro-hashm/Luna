import gc
import io
import os
import re
import threading
import time
from pathlib import Path

import numpy as np
import soundfile as sf
import torch
import torchaudio
from fastapi import FastAPI, HTTPException
from fastapi.responses import Response
from f5_tts.api import F5TTS
from huggingface_hub import hf_hub_download
from num2words import num2words
from pydantic import BaseModel, Field


MODEL_ID = os.getenv("F5_MODEL_ID", "firstpixel/F5-TTS-pt-br")
MODEL_FILE = os.getenv("F5_MODEL_FILE", "pt-br/model_last.safetensors")
REFERENCE_AUDIO = Path(os.getenv("F5_REFERENCE_AUDIO", "/reference/Luna-Voice-F5.wav"))
REFERENCE_TEXT = Path(os.getenv("F5_REFERENCE_TEXT", "/reference/Luna-Voice-F5.txt"))
NFE_STEP = max(8, min(64, int(os.getenv("F5_NFE_STEP", "16"))))
IDLE_UNLOAD_SECONDS = int(os.getenv("F5_IDLE_UNLOAD_SECONDS", "300"))

app = FastAPI(title="Luna F5-TTS pt-BR")
model: F5TTS | None = None
reference_text: str | None = None
last_used_at = 0.0
model_lock = threading.Lock()
number_pattern = re.compile(r"\d+")
_torchaudio_load = torchaudio.load


def _load_audio_compat(uri: str | Path, *args, **kwargs):
    try:
        return _torchaudio_load(uri, *args, **kwargs)
    except Exception as error:
        if "TorchCodec" not in str(error):
            raise
        waveform, sample_rate = sf.read(uri, dtype="float32", always_2d=True)
        return torch.from_numpy(waveform.T.copy()), sample_rate


# Torchaudio 2.11 routes audio decoding through TorchCodec. This service only
# uses the local PCM WAV reference, so decode it with SoundFile instead.
torchaudio.load = _load_audio_compat


class SpeechRequest(BaseModel):
    input: str = Field(min_length=1, max_length=6000)
    speed: float = Field(default=1.0, ge=0.5, le=2.0)


def normalize_pt_br_text(text: str) -> str:
    def spell_number(match: re.Match[str]) -> str:
        try:
            return num2words(int(match.group()), lang="pt_BR")
        except (NotImplementedError, ValueError):
            return match.group()

    # This Brazilian Portuguese checkpoint was trained with lowercase text.
    return number_pattern.sub(spell_number, text).lower().strip()


def load_model() -> tuple[F5TTS, str]:
    global model, reference_text, last_used_at
    if model is not None and reference_text is not None:
        last_used_at = time.monotonic()
        return model, reference_text

    if not torch.cuda.is_available():
        raise HTTPException(status_code=503, detail="F5-TTS needs a CUDA GPU in this setup")
    if not REFERENCE_AUDIO.is_file() or not REFERENCE_TEXT.is_file():
        raise HTTPException(status_code=503, detail="F5-TTS reference audio or transcript is missing")

    try:
        checkpoint = hf_hub_download(repo_id=MODEL_ID, filename=MODEL_FILE)
        model = F5TTS(model="F5TTS_Base", ckpt_file=checkpoint, device="cuda", use_ema=True)
        reference_text = REFERENCE_TEXT.read_text(encoding="utf-8").strip().lower()
        last_used_at = time.monotonic()
        return model, reference_text
    except HTTPException:
        raise
    except Exception as error:
        model = None
        reference_text = None
        gc.collect()
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
        raise HTTPException(status_code=503, detail=f"Could not load F5-TTS pt-BR: {error}") from error


@app.get("/healthz")
def health() -> dict[str, object]:
    return {"status": "ok", "model_loaded": model is not None, "model": MODEL_ID}


@app.post("/v1/audio/speech")
def synthesize(request: SpeechRequest) -> Response:
    global last_used_at
    text = normalize_pt_br_text(request.input)
    if not text:
        raise HTTPException(status_code=422, detail="input is empty after Portuguese normalization")

    with model_lock:
        tts, ref_text = load_model()
        started_at = time.perf_counter()
        try:
            with torch.inference_mode():
                wav, sample_rate, _ = tts.infer(
                    ref_file=str(REFERENCE_AUDIO),
                    ref_text=ref_text,
                    gen_text=text,
                    nfe_step=NFE_STEP,
                    speed=request.speed,
                    remove_silence=False,
                )
            audio = io.BytesIO()
            sf.write(audio, np.asarray(wav), sample_rate, format="WAV", subtype="PCM_16")
            last_used_at = time.monotonic()
            response = Response(content=audio.getvalue(), media_type="audio/wav")
            response.headers["X-Inference-Ms"] = str(round((time.perf_counter() - started_at) * 1000))
            response.headers["X-F5-NFE-Step"] = str(NFE_STEP)
            return response
        except HTTPException:
            raise
        except Exception as error:
            raise HTTPException(status_code=500, detail=f"F5-TTS synthesis failed: {error}") from error


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
