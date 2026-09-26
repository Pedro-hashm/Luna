FROM pytorch/pytorch:2.11.0-cuda13.0-cudnn9-runtime

WORKDIR /app
ENV PIP_BREAK_SYSTEM_PACKAGES=1

RUN apt-get update && apt-get install -y --no-install-recommends sox libsox-fmt-all ffmpeg \
    && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir --index-url https://download.pytorch.org/whl/cu130 torchaudio==2.11.0+cu130 \
    && pip install --no-cache-dir faster-qwen3-tts==0.5.2 accelerate==1.12.0 librosa fastapi uvicorn

COPY services/qwen-tts-fast/app.py ./app.py

EXPOSE 8100
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8100"]
