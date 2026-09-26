"""HTTP adapter for the Luna openWakeWord provider."""

from __future__ import annotations

import json
import hashlib

from fastapi import FastAPI, Header, HTTPException, Query, Request
from fastapi.responses import JSONResponse

from .provider import pool_from_env


app = FastAPI(title="Luna Wake Word", version="1.0.0")
pool = pool_from_env()


@app.get("/status")
def status():
    metadata_path = pool.model_path.with_suffix(".metadata.json")
    try:
        metadata = json.loads(metadata_path.read_text(encoding="utf-8")) if metadata_path.is_file() else {}
    except (OSError, ValueError):
        metadata = {}
    model_sha = hashlib.sha256(pool.model_path.read_bytes()).hexdigest() if pool.model_path.is_file() else None
    metadata_matches = metadata.get("sha256") == model_sha and model_sha is not None
    return {
        "modelReady": pool.ready,
        "model": pool.model_path.stem,
        "modelPath": str(pool.model_path),
        "validationState": metadata.get("state", "unvalidated") if metadata_matches else "unvalidated",
        "evaluation": metadata.get("evaluation") if metadata_matches else None,
        "verifierEnabled": pool.verifier_path is not None,
        "activeSessions": pool.active_sessions,
        "error": pool.load_error if pool.load_error else (
            None if pool.model_path.is_file() else "luna.onnx has not been installed"
        ),
    }


@app.get("/health")
def health():
    if not pool.ready:
        return JSONResponse(status_code=503, content=status())
    return status()


@app.post("/detect")
@app.post("/predict")
async def detect(request: Request,
                 threshold: float = Query(default=0.5, ge=0, le=1),
                 verifier_enabled: bool | None = Query(default=None),
                 verifier_model: str | None = Query(default=None),
                 verifier_threshold: float | None = Query(default=None, ge=0, le=1),
                 x_voice_session_id: str = Header(default="default")):
    if not pool.ready:
        raise HTTPException(status_code=503, detail=status())
    body = await request.body()
    if not body or len(body) % 2 or len(body) > 64_000:
        raise HTTPException(status_code=400, detail="Expected 16 kHz mono PCM16 LE, 1 to 32000 samples")
    try:
        result = pool.get(x_voice_session_id,
                          verifier_enabled=verifier_enabled,
                          verifier_model=verifier_model,
                          verifier_threshold=verifier_threshold).predict(body, threshold)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except (FileNotFoundError, RuntimeError) as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return result.__dict__


@app.post("/reset")
def reset(release: bool = Query(default=False), x_voice_session_id: str = Header(default="default")):
    pool.reset(x_voice_session_id, release=release)
    return {"reset": True, "released": release}


@app.post("/reload")
def reload_model():
    try:
        pool.reload()
    except Exception as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return status()
