FROM ghcr.io/ggml-org/llama.cpp:server AS llama

FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    RERANKER_MODEL_DIR=/models \
    LLAMA_SERVER_BINARY=/llama/llama-server \
    LD_LIBRARY_PATH=/llama

RUN apt-get update \
    && apt-get install -y --no-install-recommends libgomp1 \
    && rm -rf /var/lib/apt/lists/*

COPY --from=llama /app /llama
WORKDIR /app
COPY apps/reranker/requirements.txt ./requirements.txt
RUN pip install --upgrade pip \
    && pip install --index-url https://download.pytorch.org/whl/cpu --extra-index-url https://pypi.org/simple "torch==2.14.0+cpu" \
    && pip install -r requirements.txt

COPY apps/reranker/main.py ./main.py
EXPOSE 8200
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8200"]
