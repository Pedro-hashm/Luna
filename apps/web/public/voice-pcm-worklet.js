// AudioWorklet: mono microphone PCM16, resampled to 16 kHz in 20 ms frames.
class VoicePcmProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.targetRate = 16000;
    this.step = sampleRate / this.targetRate;
    this.position = 0;
    this.samples = [];
  }

  process(inputs, outputs) {
    const channels = inputs[0];
    const output = outputs[0];
    for (const channel of output) channel.fill(0);
    if (!channels?.length) return true;

    const input = channels[0];
    while (this.position < input.length) {
      const index = Math.floor(this.position);
      const fraction = this.position - index;
      const first = input[index] ?? 0;
      const second = input[Math.min(index + 1, input.length - 1)] ?? first;
      this.samples.push(first + (second - first) * fraction);
      this.position += this.step;
      if (this.samples.length === 320) this.emitFrame();
    }
    this.position -= input.length;
    return true;
  }

  emitFrame() {
    const pcm = new Int16Array(320);
    let sumSquares = 0;
    for (let index = 0; index < pcm.length; index += 1) {
      const sample = Math.max(-1, Math.min(1, this.samples[index]));
      sumSquares += sample * sample;
      pcm[index] = Math.round(sample < 0 ? sample * 32768 : sample * 32767);
    }
    this.samples.length = 0;
    this.port.postMessage({ pcm: pcm.buffer, rms: Math.sqrt(sumSquares / pcm.length) }, [pcm.buffer]);
  }
}

registerProcessor("voice-pcm-processor", VoicePcmProcessor);
