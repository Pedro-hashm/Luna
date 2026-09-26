FROM pytorch/pytorch:2.11.0-cuda13.0-cudnn9-runtime

WORKDIR /app
ENV PIP_BREAK_SYSTEM_PACKAGES=1
RUN apt-get update && apt-get install -y --no-install-recommends sox libsox-fmt-all ffmpeg \
    && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir qwen-tts==0.1.1 --no-deps \
    && pip install --no-cache-dir transformers==4.57.3 accelerate==1.12.0 librosa soundfile onnxruntime einops fastapi uvicorn sox \
    && pip install --no-cache-dir --index-url https://download.pytorch.org/whl/cu130 torchaudio==2.11.0+cu130

COPY services/qwen-tts/app.py ./app.py

EXPOSE 8100
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8100"]
