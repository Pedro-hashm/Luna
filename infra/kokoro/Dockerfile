FROM ghcr.io/openttsgroup/kokoro-open-tts@sha256:135171972ead991f352cdf85dbff3608d4f681468b1099857e88131637fd628c

# The upstream image deliberately exposes only its fixed built-in catalog.
# This small overlay admits local Kokoro .pt voice packs from a controlled
# volume. It retains the upstream engine, model installation, and cache.
COPY infra/kokoro/enable_voice_packs.py /tmp/enable_voice_packs.py
RUN python /tmp/enable_voice_packs.py && rm /tmp/enable_voice_packs.py
