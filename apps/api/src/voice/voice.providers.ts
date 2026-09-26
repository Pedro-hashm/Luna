import { Injectable } from '@nestjs/common';
import type { SttProvider, TtsProvider, WakeWordProvider } from './voice.types';

function endpoint(base: string, path: string): string {
  return `${base.replace(/\/+$/u, '')}${path}`;
}

async function errorFor(response: Response, provider: string): Promise<Error> {
  const detail = (await response.text()).slice(0, 500);
  return new Error(`${provider} returned HTTP ${response.status}: ${detail}`);
}

async function requestProvider(provider: string, url: string, init: RequestInit): Promise<Response> {
  try { return await fetch(url, init); }
  catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`${provider} is unavailable or timed out: ${detail}`);
  }
}

export function pcm16ToWav(pcm16: Buffer): Buffer {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm16.length, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(16000, 24);
  header.writeUInt32LE(32000, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm16.length, 40);
  return Buffer.concat([header, pcm16]);
}

@Injectable()
export class SpeachesSttProvider implements SttProvider {
  readonly name = 'speaches';

  async transcribe(pcm16: Buffer, signal?: AbortSignal): Promise<string> {
    const form = new FormData();
    form.append('model', process.env.SPEACHES_STT_MODEL ?? 'Systran/faster-whisper-small');
    // Whisper otherwise auto-detects the language independently for every
    // utterance, which is unreliable for short Brazilian Portuguese speech.
    form.append('language', process.env.SPEACHES_STT_LANGUAGE ?? 'pt');
    form.append('file', new Blob([new Uint8Array(pcm16ToWav(pcm16))], { type: 'audio/wav' }), 'speech.wav');
    const response = await requestProvider(this.name, endpoint(process.env.SPEACHES_BASE_URL ?? 'http://speaches:8000', '/v1/audio/transcriptions'), {
      method: 'POST', body: form, signal: signal ?? AbortSignal.timeout(120_000),
    });
    if (!response.ok) throw await errorFor(response, this.name);
    const data = await response.json() as { text?: unknown };
    if (typeof data.text !== 'string') throw new Error('Speaches returned no transcript');
    return data.text.trim();
  }
}

@Injectable()
export class KokoroTtsProvider implements TtsProvider {
  readonly name = 'kokoro';

  async synthesize(text: string, voiceId: string, speed: number, signal?: AbortSignal): Promise<{ audio: Buffer; mimeType: string }> {
    const effectiveSpeed = voiceId === 'pack://pf_luna_nobre' ? Math.max(0.5, Math.min(2, speed * 0.96)) : speed;
    const response = await requestProvider(this.name, endpoint(process.env.KOKORO_BASE_URL ?? 'http://kokoro:8000', '/v1/audio/speech'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: process.env.KOKORO_TTS_MODEL ?? 'kokoro', input: text, voice: voiceId, speed: effectiveSpeed, response_format: 'mp3' }),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(120_000)]) : AbortSignal.timeout(120_000),
    });
    if (!response.ok) throw await errorFor(response, this.name);
    return { audio: Buffer.from(await response.arrayBuffer()), mimeType: response.headers.get('content-type')?.split(';')[0] ?? 'audio/mpeg' };
  }

  async listVoices(): Promise<string[]> {
    const response = await requestProvider(this.name, endpoint(process.env.KOKORO_BASE_URL ?? 'http://kokoro:8000', '/v1/audio/voices'), { signal: AbortSignal.timeout(5_000) });
    if (!response.ok) throw await errorFor(response, this.name);
    const data: unknown = await response.json();
    const items = Array.isArray(data) ? data : (data && typeof data === 'object' && 'voices' in data ? (data as { voices: unknown }).voices : []);
    if (!Array.isArray(items)) return [];
    return items.flatMap((item) => typeof item === 'string' ? [item] : item && typeof item === 'object' && typeof (item as { id?: unknown }).id === 'string' ? [(item as { id: string }).id] : []);
  }
}

@Injectable()
export class QwenTtsProvider implements TtsProvider {
  readonly name = 'qwen3-tts';

  async synthesize(text: string, _voiceId: string, _speed: number, signal?: AbortSignal): Promise<{ audio: Buffer; mimeType: string }> {
    const response = await requestProvider(this.name, endpoint(process.env.QWEN_TTS_BASE_URL ?? 'http://qwen-tts:8100', '/v1/audio/speech'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ input: text }),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(300_000)]) : AbortSignal.timeout(300_000),
    });
    if (!response.ok) throw await errorFor(response, this.name);
    return { audio: Buffer.from(await response.arrayBuffer()), mimeType: response.headers.get('content-type')?.split(';')[0] ?? 'audio/wav' };
  }

  async listVoices(): Promise<string[]> { return ['luna-clone']; }
}

@Injectable()
export class FasterQwenTtsProvider implements TtsProvider {
  readonly name = 'faster-qwen3-tts';

  async synthesize(text: string, _voiceId: string, _speed: number, signal?: AbortSignal): Promise<{ audio: Buffer; mimeType: string }> {
    const response = await requestProvider(this.name, endpoint(process.env.QWEN_TTS_FAST_BASE_URL ?? 'http://qwen-tts-fast:8100', '/v1/audio/speech'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ input: text }),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(300_000)]) : AbortSignal.timeout(300_000),
    });
    if (!response.ok) throw await errorFor(response, this.name);
    return { audio: Buffer.from(await response.arrayBuffer()), mimeType: response.headers.get('content-type')?.split(';')[0] ?? 'audio/wav' };
  }

  async listVoices(): Promise<string[]> { return ['luna-clone']; }
}

@Injectable()
export class F5TtsProvider implements TtsProvider {
  readonly name = 'f5-tts-pt-br';

  async synthesize(text: string, _voiceId: string, speed: number, signal?: AbortSignal): Promise<{ audio: Buffer; mimeType: string }> {
    const response = await requestProvider(this.name, endpoint(process.env.F5_TTS_BASE_URL ?? 'http://f5-tts:8100', '/v1/audio/speech'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ input: text, speed }),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(300_000)]) : AbortSignal.timeout(300_000),
    });
    if (!response.ok) throw await errorFor(response, this.name);
    return { audio: Buffer.from(await response.arrayBuffer()), mimeType: response.headers.get('content-type')?.split(';')[0] ?? 'audio/wav' };
  }

  async listVoices(): Promise<string[]> { return ['luna-clone']; }
}

@Injectable()
export class FishAudioTtsProvider implements TtsProvider {
  readonly name = 'fish-audio';

  async synthesize(text: string, referenceId: string, speed: number, signal?: AbortSignal): Promise<{ audio: Buffer; mimeType: string }> {
    const apiKey = process.env.FISH_AUDIO_API_KEY?.trim();
    if (!apiKey) throw new Error('Fish Audio API key is missing; set FISH_AUDIO_API_KEY in the project .env file');
    if (!referenceId.trim()) throw new Error('Fish Audio reference_id is required; enter it in voice settings');

    const response = await requestProvider(this.name, 'https://api.fish.audio/v1/tts', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
        model: 's2.1-pro-free',
      },
      body: JSON.stringify({ text, reference_id: referenceId.trim(), format: 'mp3', prosody: { speed } }),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(120_000)]) : AbortSignal.timeout(120_000),
    });
    if (!response.ok) throw await errorFor(response, this.name);
    return { audio: Buffer.from(await response.arrayBuffer()), mimeType: response.headers.get('content-type')?.split(';')[0] ?? 'audio/mpeg' };
  }

  async listVoices(): Promise<string[]> { return []; }
}

@Injectable()
export class OpenWakeWordProvider implements WakeWordProvider {
  readonly name = 'openWakeWord';

  async status(): Promise<Record<string, unknown>> {
    const response = await requestProvider(this.name, endpoint(process.env.WAKEWORD_BASE_URL ?? 'http://wakeword:8765', '/status'), { signal: AbortSignal.timeout(3_000) });
    if (!response.ok) throw await errorFor(response, this.name);
    return await response.json() as Record<string, unknown>;
  }

  async detect(frame: Buffer, sessionId: string, threshold: number, verifier?: { enabled: boolean; model: string | null; threshold: number }): Promise<{ detected: boolean; score: number; model: string; timestamp: number }> {
    const query = new URLSearchParams({ threshold: String(threshold), verifier_enabled: verifier?.enabled ? '1' : '0' });
    if (verifier?.enabled) {
      query.set('verifier_threshold', String(verifier.threshold));
      if (verifier.model) query.set('verifier_model', verifier.model);
    }
    const response = await requestProvider(this.name, endpoint(process.env.WAKEWORD_BASE_URL ?? 'http://wakeword:8765', `/detect?${query.toString()}`), {
      method: 'POST', headers: { 'content-type': 'application/octet-stream', 'x-voice-session-id': sessionId },
      body: new Uint8Array(frame), signal: AbortSignal.timeout(3_000),
    });
    if (!response.ok) throw await errorFor(response, this.name);
    const result = await response.json() as Record<string, unknown>;
    return {
      detected: result.detected === true,
      score: typeof result.score === 'number' ? result.score : 0,
      model: typeof result.model === 'string' ? result.model : 'luna',
      timestamp: typeof result.timestamp === 'number' ? result.timestamp : Date.now(),
    };
  }

  async reset(sessionId: string, release = false): Promise<void> {
    try {
      await fetch(endpoint(process.env.WAKEWORD_BASE_URL ?? 'http://wakeword:8765', release ? '/reset?release=1' : '/reset'), {
        method: 'POST', headers: { 'x-voice-session-id': sessionId }, signal: AbortSignal.timeout(2_000),
      });
    } catch { /* a reset failure cannot hold the user session open */ }
  }
}
