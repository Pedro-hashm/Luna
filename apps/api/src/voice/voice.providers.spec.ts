import { KokoroTtsProvider, OpenWakeWordProvider, SpeachesSttProvider, pcm16ToWav } from './voice.providers';

describe('PCM16 to WAV', () => {
  it('labels mono 16 kHz audio and preserves the samples', () => {
    const samples = Buffer.from([1, 0, 255, 127, 0, 128]);
    const wav = pcm16ToWav(samples);
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
    expect(wav.toString('ascii', 8, 12)).toBe('WAVE');
    expect(wav.readUInt16LE(22)).toBe(1);
    expect(wav.readUInt32LE(24)).toBe(16_000);
    expect(wav.readUInt16LE(34)).toBe(16);
    expect(wav.readUInt32LE(40)).toBe(samples.length);
    expect(wav.subarray(44)).toEqual(samples);
  });
});

describe('Voice provider failures', () => {
  afterEach(() => jest.restoreAllMocks());

  it('identifies the offline provider to the UI', async () => {
    jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('connect ECONNREFUSED'));
    await expect(new SpeachesSttProvider().transcribe(Buffer.alloc(6400))).rejects.toThrow('speaches is unavailable');
    await expect(new KokoroTtsProvider().synthesize('Olá', 'pf_dora', 1)).rejects.toThrow('kokoro is unavailable');
    await expect(new OpenWakeWordProvider().detect(Buffer.alloc(2560), 'session', 0.5)).rejects.toThrow('openWakeWord is unavailable');
  });
});

describe('Speaches language', () => {
  afterEach(() => jest.restoreAllMocks());

  it('sends Portuguese instead of asking Whisper to detect each utterance', async () => {
    const previous = process.env.SPEACHES_STT_LANGUAGE;
    delete process.env.SPEACHES_STT_LANGUAGE;
    try {
      const request = jest.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
        const form = init?.body as FormData;
        expect(form.get('language')).toBe('pt');
        expect(form.get('model')).toBeTruthy();
        expect(form.get('file')).toBeInstanceOf(Blob);
        return new Response(JSON.stringify({ text: 'Olá, eu sou a Luna.' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      });
      await expect(new SpeachesSttProvider().transcribe(Buffer.alloc(6400))).resolves.toBe('Olá, eu sou a Luna.');
      expect(request).toHaveBeenCalledTimes(1);
    } finally {
      if (previous === undefined) delete process.env.SPEACHES_STT_LANGUAGE;
      else process.env.SPEACHES_STT_LANGUAGE = previous;
    }
  });
});

describe('openWakeWord session lifecycle', () => {
  afterEach(() => jest.restoreAllMocks());

  it('resets model state without unloading it and releases it on session end', async () => {
    const request = jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
    const wake = new OpenWakeWordProvider();
    await wake.reset('voice-session');
    await wake.reset('voice-session', true);
    expect(String(request.mock.calls[0][0])).toContain('/reset');
    expect(String(request.mock.calls[0][0])).not.toContain('release=1');
    expect(String(request.mock.calls[1][0])).toContain('/reset?release=1');
  });
});
