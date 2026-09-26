FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    OMP_NUM_THREADS=1 \
    OPENBLAS_NUM_THREADS=1

RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg libportaudio2 \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /workspace/tools/wakeword-training
COPY tools/wakeword-training/requirements.txt /tmp/training-requirements.txt
RUN pip install --no-cache-dir torch==2.7.1 --index-url https://download.pytorch.org/whl/cpu \
    && pip install --no-cache-dir -r /tmp/training-requirements.txt \
    && pip install --no-cache-dir --no-deps openwakeword==0.6.0
COPY services/wakeword/install_features.py /tmp/install_features.py
RUN python /tmp/install_features.py
COPY tools/wakeword-training/config ./config
COPY tools/wakeword-training/scripts ./scripts
RUN mkdir -p data/positive data/negative data/background data/rir data/recordings models reports \
    /workspace/services/wakeword/models

CMD ["python", "scripts/prepare_data.py"]
