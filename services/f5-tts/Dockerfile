FROM pytorch/pytorch:2.11.0-cuda13.0-cudnn9-runtime

WORKDIR /app
ENV PIP_BREAK_SYSTEM_PACKAGES=1

# Install inference dependencies plus the dataset module imported eagerly by
# the upstream model package. Gradio and bitsandbytes are not needed here.
RUN pip install --no-cache-dir f5-tts==1.1.22 --no-deps \
    && pip install --no-cache-dir accelerate cached_path datasets ema_pytorch fastapi hydra-core librosa matplotlib num2words pydub pypinyin rjieba safetensors soundfile torchdiffeq transformers==4.57.3 uvicorn wandb vocos x-transformers

COPY services/f5-tts/app.py ./app.py

EXPOSE 8100
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8100"]
