import { BadRequestException, Injectable, Logger, NotFoundException, Optional, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { F5TtsProvider, FasterQwenTtsProvider, FishAudioTtsProvider, KokoroTtsProvider, pcm16ToWav, QwenTtsProvider } from './voice.providers';
import { VoiceService } from './voice.service';

const SEGMENT_SIZE = 2_000;

export function forSpeech(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\(https?:\/\/[^\s)]+\)/giu, '$1')
    .replace(/https?:\/\/\S+/giu, '')
    .replace(/[*_`#]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();
}

export function speechSegment(text: string, offset: number) {
  if (offset < 0 || offset >= text.length) throw new BadRequestException('Não há texto para ler nesta posição.');
  let end = Math.min(offset + SEGMENT_SIZE, text.length);
  if (end < text.length) {
    const part = text.slice(offset, end);
    const sentence = Math.max(part.lastIndexOf('. '), part.lastIndexOf('! '), part.lastIndexOf('? '));
    const word = part.lastIndexOf(' ');
    if (sentence >= SEGMENT_SIZE / 2) end = offset + sentence + 2;
    else if (word >= SEGMENT_SIZE / 2) end = offset + word + 1;
    else if (/[\uDC00-\uDFFF]/u.test(text.charAt(end))) end -= 1;
  }
  return { text: text.slice(offset, end).trim(), next: end < text.length ? end : null };
}

@Injectable()
export class VoiceSynthesisService {
  private readonly logger = new Logger(VoiceSynthesisService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly voice: VoiceService,
    private readonly kokoro: KokoroTtsProvider,
    @Optional() private readonly qwen?: QwenTtsProvider,
    @Optional() private readonly f5?: F5TtsProvider,
    @Optional() private readonly fasterQwen?: FasterQwenTtsProvider,
    @Optional() private readonly fish?: FishAudioTtsProvider,
  ) {}

  async resolve() {
    const settings = await this.settings.getApplicationSettings();
    const engine = settings.voiceTtsEngine;
    const profileId = engine === 'fish' ? null : settings.voiceProfileId;
    const voiceId = engine === 'fish' ? settings.fishAudioReferenceId
      : engine === 'qwen-fast' ? settings.qwenFastVoiceId
      : await this.voice.voiceIdForProfile(settings.voiceProfileId);
    const provider = engine === 'fish' ? this.fish
      : engine === 'qwen' && this.qwen ? this.qwen
      : engine === 'qwen-fast' && this.fasterQwen ? this.fasterQwen
      : engine === 'f5' && this.f5 ? this.f5 : this.kokoro;
    if (!provider) throw new Error('Fish Audio provider is unavailable');
    const streaming = engine === 'qwen-fast' && settings.voiceTtsStreamingEnabled ? this.fasterQwen : undefined;
    return { engine, profileId, voiceId, provider, streaming, speed: settings.voiceSpeed };
  }

  async readMessage(conversationId: string, messageId: string, offset: number, signal: AbortSignal) {
    const message = await this.prisma.message.findFirst({
      where: { id: messageId, conversationId, role: { in: ['user', 'assistant'] } },
      select: { content: true },
    });
    if (!message) throw new NotFoundException('Mensagem não encontrada nesta conversa.');
    const segment = speechSegment(forSpeech(message.content), offset);
    const started = Date.now();
    try {
      const { provider, voiceId, speed } = await this.resolve();
      signal.throwIfAborted();
      const result = await provider.synthesize(segment.text, voiceId, speed, signal);
      if (!result.audio.length) throw new Error('Empty audio');
      this.logger.log(JSON.stringify({
        event: 'chat.speech.completed', provider: provider.name, bytes: result.audio.length, latencyMs: Date.now() - started,
      }));
      return { ...result, next: segment.next };
    } catch (error) {
      if (signal.aborted) throw error;
      this.logger.warn(JSON.stringify({ event: 'chat.speech.failed', latencyMs: Date.now() - started }));
      throw new ServiceUnavailableException('Não foi possível gerar o áudio com a voz configurada.');
    }
  }

  async synthesizeText(text: string, signal: AbortSignal) {
    const spoken = forSpeech(text);
    if (!spoken) throw new BadRequestException('Não há texto para sintetizar.');
    signal.throwIfAborted();
    const started = Date.now();
    try {
      const { provider, voiceId, speed, streaming } = await this.resolve();
      let result: { audio: Buffer; mimeType: string };
      if (streaming) {
        const stream = await streaming.synthesizeStream(spoken, voiceId, speed, signal);
        const chunks: Buffer[] = [];
        let bytes = 0;
        try {
          for await (const chunk of stream.chunks) {
            signal.throwIfAborted();
            bytes += chunk.length;
            if (bytes > 24 * 1024 * 1024) throw new Error('Speech response is too large');
            chunks.push(chunk);
          }
        } catch (error) {
          await stream.cancel();
          throw error;
        }
        const pcm = Buffer.concat(chunks);
        if (!pcm.length || pcm.length % 2) throw new Error('Invalid streamed PCM audio');
        result = { audio: pcm16ToWav(pcm, stream.sampleRate), mimeType: 'audio/wav' };
      } else {
        result = await provider.synthesize(spoken, voiceId, speed, signal);
      }
      if (!result.audio.length) throw new Error('Empty audio');
      this.logger.log(JSON.stringify({
        event: 'chat.speech.completed', provider: provider.name, bytes: result.audio.length, latencyMs: Date.now() - started,
      }));
      return result;
    } catch (error) {
      if (signal.aborted) throw error;
      this.logger.warn(JSON.stringify({ event: 'chat.speech.failed', latencyMs: Date.now() - started }));
      throw new ServiceUnavailableException('Não foi possível gerar o áudio com a voz configurada.');
    }
  }
}
