FROM ghcr.io/openttsgroup/kokoro-open-tts@sha256:135171972ead991f352cdf85dbff3608d4f681468b1099857e88131637fd628c

ENV PYTHONUNBUFFERED=1 \
    HF_HUB_DISABLE_TELEMETRY=1

# Add the reference-clip tuner to an isolated image. The running Kokoro
# service keeps its existing image and settings.
RUN python -m pip install --no-cache-dir "inno-kokoro==0.2.0"

COPY tools/kokoro-voice-training/create_voice.py /opt/luna-voice/create_voice.py
ENTRYPOINT ["python", "/opt/luna-voice/create_voice.py"]
