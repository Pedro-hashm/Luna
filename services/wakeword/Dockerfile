FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    OMP_NUM_THREADS=1 \
    OPENBLAS_NUM_THREADS=1 \
    WAKE_MODEL_PATH=/app/models/luna.onnx

WORKDIR /app
COPY services/wakeword/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt \
    && pip install --no-cache-dir --no-deps openwakeword==0.6.0
COPY services/wakeword/install_features.py /app/install_features.py
RUN python /app/install_features.py
COPY services/wakeword/app /app/app
RUN mkdir -p /app/models

EXPOSE 8765
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8765", "--workers", "1"]
