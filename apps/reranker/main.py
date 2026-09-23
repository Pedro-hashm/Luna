import json
import os
import re
import subprocess
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

MODEL_ROOT = Path(os.getenv("RERANKER_MODEL_DIR", "/models"))
ETTIN_DIR = MODEL_ROOT / "ettin-17m"
QWEN_DIR = MODEL_ROOT / "qwen3-0.6b-q8_0"
QWEN_FILE = QWEN_DIR / "qwen3-reranker-0.6b-q8_0.gguf"
QWEN_PORT = int(os.getenv("QWEN_RERANKER_PORT", "8201"))
QWEN_URL = f"http://127.0.0.1:{QWEN_PORT}"

app = FastAPI(title="Luna local reranker", docs_url=None, redoc_url=None)
state_lock = threading.Lock()
model_states: dict[str, dict[str, Any]] = {
    "ettin-17m": {"status": "not_installed", "error": None},
    "qwen3-0.6b-q8_0": {"status": "not_installed", "error": None},
}
ettin_model: Any = None
ettin_lock = threading.Lock()
qwen_process: subprocess.Popen[bytes] | None = None
qwen_lock = threading.Lock()


class DownloadRequest(BaseModel):
    pass


class RerankRequest(BaseModel):
    model: str
    query: str = Field(min_length=1, max_length=10000)
    documents: list[str] = Field(min_length=1, max_length=100)


def model_path(key: str) -> Path:
    if key == "ettin-17m":
        return ETTIN_DIR
    if key == "qwen3-0.6b-q8_0":
        return QWEN_FILE
    raise HTTPException(status_code=404, detail="Unknown reranker model")


def is_installed(key: str) -> bool:
    path = model_path(key)
    if key == "ettin-17m":
        return (path / "config.json").is_file() and (path / "model.safetensors").is_file()
    return path.is_file() and path.stat().st_size > 0


def file_bytes(key: str) -> int:
    path = model_path(key)
    if path.is_file():
        return path.stat().st_size
    if path.is_dir():
        return sum(item.stat().st_size for item in path.rglob("*") if item.is_file())
    return 0


def status_payload(key: str) -> dict[str, Any]:
    installed = is_installed(key)
    with state_lock:
        current = dict(model_states[key])
    loaded = (key == "ettin-17m" and ettin_model is not None) or (
        key == "qwen3-0.6b-q8_0" and qwen_process is not None and qwen_process.poll() is None
    )
    status = current["status"]
    if status not in ("downloading", "loading", "failed"):
        status = "loaded" if loaded else "installed" if installed else "not_installed"
    return {
        "key": key,
        "installed": installed,
        "loaded": loaded,
        "status": status,
        "error": current.get("error"),
        "bytes": file_bytes(key),
    }


@app.get("/health")
def health() -> dict[str, bool]:
    return {"ok": True}


@app.get("/models")
def models() -> dict[str, Any]:
    return {
        "available": True,
        "models": [status_payload("ettin-17m"), status_payload("qwen3-0.6b-q8_0")],
    }


@app.post("/models/{key}/download")
def download(key: str, _request: DownloadRequest | None = None) -> dict[str, str]:
    model_path(key)
    with state_lock:
        if model_states[key]["status"] == "downloading":
            return {"status": "downloading"}
        if is_installed(key):
            model_states[key] = {"status": "installed", "error": None}
            return {"status": "installed"}
        model_states[key] = {"status": "downloading", "error": None}

    threading.Thread(target=download_model, args=(key,), daemon=True).start()
    return {"status": "downloading"}


def download_model(key: str) -> None:
    try:
        from huggingface_hub import list_repo_files, snapshot_download

        if key == "ettin-17m":
            repo = "cross-encoder/ettin-reranker-17m-v1"
            files = list_repo_files(repo_id=repo)
            allow_patterns = [
                name
                for name in files
                if not name.startswith(("onnx/", "openvino/"))
                and not name.endswith((".onnx", ".xml", ".bin"))
            ]
            ETTIN_DIR.mkdir(parents=True, exist_ok=True)
            snapshot_download(repo_id=repo, local_dir=str(ETTIN_DIR), allow_patterns=allow_patterns)
        else:
            repo = "ggml-org/Qwen3-Reranker-0.6B-Q8_0-GGUF"
            QWEN_DIR.mkdir(parents=True, exist_ok=True)
            snapshot_download(
                repo_id=repo,
                local_dir=str(QWEN_DIR),
                allow_patterns=["qwen3-reranker-0.6b-q8_0.gguf"],
            )
        if not is_installed(key):
            raise RuntimeError("Download finished without the expected model files")
        with state_lock:
            model_states[key] = {"status": "installed", "error": None}
    except Exception as error:  # keep failure visible to the settings UI
        with state_lock:
            model_states[key] = {"status": "failed", "error": str(error)[:500]}


def load_ettin() -> Any:
    global ettin_model
    if not is_installed("ettin-17m"):
        raise HTTPException(status_code=409, detail="Download the Ettin reranker first")
    if ettin_model is not None:
        return ettin_model
    with ettin_lock:
        if ettin_model is None:
            with state_lock:
                model_states["ettin-17m"] = {"status": "loading", "error": None}
            try:
                from sentence_transformers import CrossEncoder

                ettin_model = CrossEncoder(
                    str(ETTIN_DIR),
                    max_length=512,
                    device="cpu",
                    local_files_only=True,
                )
                with state_lock:
                    model_states["ettin-17m"] = {"status": "loaded", "error": None}
            except Exception as error:
                with state_lock:
                    model_states["ettin-17m"] = {"status": "failed", "error": str(error)[:500]}
                raise HTTPException(status_code=503, detail=f"Ettin failed to load: {error}")
    return ettin_model


def ensure_qwen_server() -> None:
    global qwen_process
    if not is_installed("qwen3-0.6b-q8_0"):
        raise HTTPException(status_code=409, detail="Download the Qwen3 Q8_0 reranker first")
    with qwen_lock:
        if qwen_process is not None and qwen_process.poll() is None and qwen_ready():
            return
        if qwen_process is not None and qwen_process.poll() is None:
            qwen_process.terminate()
            qwen_process.wait(timeout=5)

        with state_lock:
            model_states["qwen3-0.6b-q8_0"] = {"status": "loading", "error": None}
        binary = os.getenv("LLAMA_SERVER_BINARY", "/llama/llama-server")
        if not Path(binary).is_file():
            binary = "llama-server"
        log = open("/tmp/qwen3-reranker.log", "ab")
        qwen_process = subprocess.Popen(
            [
                binary,
                "--model",
                str(QWEN_FILE),
                "--host",
                "127.0.0.1",
                "--port",
                str(QWEN_PORT),
                "--ctx-size",
                "8192",
                "--batch-size",
                "2048",
                "--ubatch-size",
                "2048",
                "--no-webui",
                "--embedding",
                "--rerank",
                "--pooling",
                "rank",
            ],
            stdout=log,
            stderr=subprocess.STDOUT,
        )
        for _ in range(90):
            if qwen_process.poll() is not None:
                with state_lock:
                    model_states["qwen3-0.6b-q8_0"] = {
                        "status": "failed",
                        "error": "llama.cpp reranker server exited; inspect its local log",
                    }
                raise HTTPException(status_code=503, detail="Qwen3 local server failed to start")
            if qwen_ready():
                with state_lock:
                    model_states["qwen3-0.6b-q8_0"] = {"status": "loaded", "error": None}
                return
            time.sleep(1)
        raise HTTPException(status_code=503, detail="Qwen3 local server startup timed out")


def qwen_ready() -> bool:
    try:
        with urllib.request.urlopen(f"{QWEN_URL}/health", timeout=1) as response:
            return response.status == 200
    except (urllib.error.URLError, TimeoutError):
        return False


@app.post("/rerank")
def rerank(request: RerankRequest) -> dict[str, Any]:
    if not request.documents:
        return {"model": request.model, "results": []}
    if request.model == "ettin-17m":
        model = load_ettin()
        try:
            raw_scores = model.predict([(request.query, document) for document in request.documents])
            results = []
            for index, raw_score in enumerate(raw_scores):
                score = float(raw_score)
                results.append({"index": index, "relevanceScore": score})
            results.sort(key=lambda item: (-item["relevanceScore"], item["index"]))
            return {"model": request.model, "results": results}
        except HTTPException:
            raise
        except Exception as error:
            raise HTTPException(status_code=503, detail=f"Ettin reranking failed: {error}")

    if request.model == "qwen3-0.6b-q8_0":
        ensure_qwen_server()
        body = json.dumps(
            {"query": request.query, "documents": request.documents, "top_n": len(request.documents)}
        ).encode("utf-8")
        call = urllib.request.Request(
            f"{QWEN_URL}/v1/rerank",
            data=body,
            headers={"content-type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(call, timeout=120) as response:
                payload = json.loads(response.read().decode("utf-8"))
            return {
                "model": request.model,
                "results": [
                    {
                        "index": int(item["index"]),
                        "relevanceScore": float(item["relevance_score"]),
                    }
                    for item in payload.get("results", [])
                ],
            }
        except urllib.error.HTTPError as error:
            detail = f"Qwen3 reranking failed: llama.cpp HTTP {error.code}"
            failure_body = error.read(4096).decode("utf-8", errors="replace")
            batch_error = re.search(
                r"input \((\d+) tokens\) is too large to process.*?current batch size: (\d+)",
                failure_body,
                flags=re.DOTALL,
            )
            if batch_error:
                detail += (
                    f" (input tokens: {batch_error.group(1)}, "
                    f"physical batch size: {batch_error.group(2)})"
                )
            raise HTTPException(status_code=503, detail=detail) from error
        except (urllib.error.URLError, KeyError, ValueError) as error:
            raise HTTPException(status_code=503, detail=f"Qwen3 reranking failed: {error}")

    raise HTTPException(status_code=404, detail="Unknown reranker model")
