import { Injectable, Logger, Optional } from '@nestjs/common';
import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import { ConversationService } from '../conversation/conversation.service';
import { SettingsService } from '../settings/settings.service';
import { F5TtsProvider, FasterQwenTtsProvider, FishAudioTtsProvider, KokoroTtsProvider, OpenWakeWordProvider, QwenTtsProvider, SpeachesSttProvider } from './voice.providers';
import { VoiceService } from './voice.service';
import type { VoiceMode, VoiceState } from './voice.types';

type VoiceClient = {
  socket: WebSocket;
  sessionId: string;
  conversationId: string;
  mode: VoiceMode;
  state: VoiceState;
  audio: Buffer[];
  audioBytes: number;
  audioStarted: boolean;
  wakeBuffer: Buffer[];
  wakeBytes: number;
  wakePreRoll: Buffer[];
  wakeBusy: boolean;
  lastWakeRejectAt: number;
  wakeThreshold: number;
  wakeKeyword: string;
  wakeVerifier: { enabled: boolean; model: string | null; threshold: number };
  lastWakeFrameAt: number;
  wakeGeneration: number;
  ttsAbort?: AbortController;
  generation: number;
};

@Injectable()
export class VoiceGateway {
  private readonly logger = new Logger(VoiceGateway.name);
  private readonly wss = new WebSocketServer({ noServer: true, maxPayload: 128 * 1024 });
  private readonly clients = new Map<string, VoiceClient>();

  constructor(
    private readonly voice: VoiceService,
    private readonly conversations: ConversationService,
    private readonly settings: SettingsService,
    private readonly wake: OpenWakeWordProvider,
    private readonly stt: SpeachesSttProvider,
    private readonly tts: KokoroTtsProvider,
    @Optional() private readonly qwenTts?: QwenTtsProvider,
    @Optional() private readonly f5Tts?: F5TtsProvider,
    @Optional() private readonly fasterQwenTts?: FasterQwenTtsProvider,
    @Optional() private readonly fishAudioTts?: FishAudioTtsProvider,
  ) {}

  attach(server: Server): void {
    const cleanup = setInterval(() => {
      void this.voice.expireStaleSessions(new Set(this.clients.keys())).catch((error: unknown) =>
        this.logger.warn(`Stale voice session cleanup failed: ${error instanceof Error ? error.message : String(error)}`),
      );
    }, 10 * 60_000);
    cleanup.unref();
    server.on('upgrade', (request: IncomingMessage, socket: Duplex, head: Buffer) => {
      let url: URL;
      try { url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`); }
      catch { socket.destroy(); return; }
      if (url.pathname !== '/voice/ws') return;
      const sessionId = url.searchParams.get('sessionId');
      if (!sessionId) { socket.write('HTTP/1.1 400 Bad Request\r\n\r\n'); socket.destroy(); return; }
      this.wss.handleUpgrade(request, socket, head, (webSocket) => {
        void this.connect(webSocket, sessionId).catch((error: unknown) => {
          this.logger.warn(`Voice connection rejected: ${error instanceof Error ? error.message : String(error)}`);
          webSocket.close(1008, 'Invalid voice session');
        });
      });
    });
  }

  private async connect(socket: WebSocket, sessionId: string): Promise<void> {
    const pending: Array<{ raw: RawData; binary: boolean }> = [];
    const queue = (raw: RawData, binary: boolean) => {
      if (pending.length >= 128) { socket.close(1009, 'Voice initialization backlog exceeded'); return; }
      pending.push({ raw, binary });
    };
    socket.on('message', queue);
    const session = await this.voice.getSession(sessionId);
    if (session.endedAt) throw new Error('Voice session has ended');
    const settings = await this.settings.getApplicationSettings();
    if (!settings.voiceEnabled) throw new Error('Voice is disabled');
    if (session.mode === 'wake' && !settings.wakeEnabled) throw new Error('Wake mode is disabled');
    if (socket.readyState !== WebSocket.OPEN) return;
    const client: VoiceClient = {
      socket, sessionId, conversationId: session.conversationId,
      mode: session.mode as VoiceMode, state: 'idle', audio: [], audioBytes: 0,
      audioStarted: false, wakeBuffer: [], wakeBytes: 0, wakePreRoll: [], wakeBusy: false,
      lastWakeRejectAt: 0, wakeThreshold: settings.wakeThreshold, wakeKeyword: settings.wakeKeyword,
      wakeVerifier: { enabled: settings.wakeVerifierEnabled, model: settings.wakeVerifierModel, threshold: settings.wakeVerifierThreshold },
      lastWakeFrameAt: 0, wakeGeneration: 0, generation: 0,
    };
    const previous = this.clients.get(sessionId);
    if (previous) {
      previous.generation += 1;
      previous.wakeGeneration += 1;
      previous.ttsAbort?.abort();
      previous.socket.close(1000, 'Voice session reconnected');
    }
    this.clients.set(sessionId, client);
    socket.on('close', () => {
      client.generation += 1;
      client.wakeGeneration += 1;
      client.ttsAbort?.abort();
      if (this.clients.get(sessionId) === client) {
        this.clients.delete(sessionId);
        void this.voice.state(sessionId, 'idle').catch(() => undefined);
        void this.voice.event(sessionId, 'voice.disconnected').catch(() => undefined);
        void this.wake.reset(sessionId, true);
      }
    });
    await this.voice.state(sessionId, 'idle');
    this.send(client, { type: 'state', state: 'idle', mode: client.mode, conversationId: client.conversationId });
    if (client.mode === 'wake') await this.voice.event(sessionId, 'voice.wake.started', { provider: this.wake.name });
    if (socket.readyState !== WebSocket.OPEN) return;
    const onMessage = (raw: RawData, binary: boolean) => {
      void (binary ? this.audioFrame(client, Buffer.from(raw as Buffer)) : this.command(client, raw.toString()))
        .catch((error: unknown) => this.fail(client, error));
    };
    socket.off('message', queue);
    socket.on('message', onMessage);
    for (const message of pending) onMessage(message.raw, message.binary);
  }

  closeSession(sessionId: string): void {
    const client = this.clients.get(sessionId);
    if (!client) { void this.wake.reset(sessionId, true); return; }
    this.clients.delete(sessionId);
    client.generation += 1;
    client.wakeGeneration += 1;
    client.ttsAbort?.abort();
    client.socket.close(1000, 'Voice session completed');
    void this.wake.reset(sessionId, true);
  }

  private send(client: VoiceClient, value: Record<string, unknown>): void {
    if (client.socket.readyState === WebSocket.OPEN) client.socket.send(JSON.stringify(value));
  }

  private async setState(client: VoiceClient, state: VoiceState): Promise<void> {
    client.state = state;
    await this.voice.state(client.sessionId, state);
    this.send(client, { type: 'state', state, mode: client.mode });
  }

  private async command(client: VoiceClient, raw: string): Promise<void> {
    let value: Record<string, unknown>;
    try { value = JSON.parse(raw) as Record<string, unknown>; }
    catch { throw new Error('Invalid voice command JSON'); }
    if (value.type === 'listen.start') {
      if (client.mode === 'wake' && client.state === 'idle') return;
      if (client.state !== 'idle' && client.state !== 'wake_detected' && client.state !== 'listening') return;
      client.audio = []; client.audioBytes = 0; client.audioStarted = false;
      await this.setState(client, 'listening');
      return;
    }
    if (value.type === 'listen.stop') {
      if (client.state === 'listening') await this.processUtterance(client);
      return;
    }
    if (value.type === 'session.end') {
      await this.voice.endSession(client.sessionId);
      this.closeSession(client.sessionId);
      return;
    }
    if (value.type === 'wake.reset') {
      if (client.mode === 'wake' && client.state === 'idle') await this.resetWake(client);
      return;
    }
    if (value.type === 'playback.complete') {
      if (client.state === 'speaking') await this.finishResponse(client);
      return;
    }
    if (value.type === 'barge_in') {
      const configured = await this.settings.getApplicationSettings();
      if (configured.voiceBargeInEnabled && client.state === 'speaking') {
        client.generation += 1;
        client.ttsAbort?.abort();
        client.audio = []; client.audioBytes = 0; client.audioStarted = false;
        await this.voice.event(client.sessionId, 'voice.barge_in');
        this.send(client, { type: 'audio.cancel' });
        await this.setState(client, 'listening');
      }
      return;
    }
    if (value.type === 'mode.set') {
      if (value.mode !== 'wake' && value.mode !== 'live') throw new Error('Invalid voice mode');
      const nextMode = value.mode;
      // Persist and validate first so a rejected change cannot leave the
      // socket running in a different mode from its VoiceSession.
      await this.voice.changeMode(client.sessionId, nextMode);
      client.generation += 1;
      client.wakeGeneration += 1;
      client.ttsAbort?.abort();
      client.mode = nextMode;
      const settings = await this.settings.getApplicationSettings();
      client.wakeThreshold = settings.wakeThreshold;
      client.wakeKeyword = settings.wakeKeyword;
      client.wakeVerifier = { enabled: settings.wakeVerifierEnabled, model: settings.wakeVerifierModel, threshold: settings.wakeVerifierThreshold };
      client.audio = []; client.audioBytes = 0; client.wakeBuffer = []; client.wakeBytes = 0; client.wakePreRoll = [];
      await this.wake.reset(client.sessionId, nextMode === 'live');
      await this.setState(client, client.mode === 'live' ? 'listening' : 'idle');
      if (client.mode === 'wake') await this.voice.event(client.sessionId, 'voice.wake.started', { provider: this.wake.name });
      return;
    }
    throw new Error('Unsupported voice command');
  }

  private async audioFrame(client: VoiceClient, frame: Buffer): Promise<void> {
    if (frame.length === 0 || frame.length % 2 !== 0 || frame.length > 128 * 1024) throw new Error('Expected PCM16 mono audio frame');
    if (client.mode === 'wake' && client.state === 'idle') {
      if (client.lastWakeFrameAt && Date.now() - client.lastWakeFrameAt > 1_000) await this.resetWake(client);
      client.lastWakeFrameAt = Date.now();
      client.wakeBuffer.push(frame); client.wakeBytes += frame.length;
      if (client.wakeBytes >= 2_560 && !client.wakeBusy) await this.processWake(client);
      return;
    }
    if (client.state !== 'listening' && client.state !== 'wake_detected') return;
    if (!client.audioStarted) {
      client.audioStarted = true;
      void this.voice.event(client.sessionId, 'voice.audio.started').catch((error: unknown) =>
        this.logger.warn(`Could not persist audio start: ${error instanceof Error ? error.message : String(error)}`),
      );
    }
    client.audio.push(frame); client.audioBytes += frame.length;
    if (client.audioBytes > 1_440_000) throw new Error('Voice utterance exceeded 45 seconds');
  }

  private async processWake(client: VoiceClient): Promise<void> {
    if (client.wakeBusy || client.state !== 'idle') return;
    client.wakeBusy = true;
    try {
      // openWakeWord emits a score every 80 ms. Feeding 320 ms at once keeps
      // only the final score and can skip a short "Luna" entirely.
      while (client.wakeBytes >= 2_560 && client.state === 'idle') {
        const queued = Buffer.concat(client.wakeBuffer);
        const frame = queued.subarray(0, 2_560);
        const remaining = queued.subarray(2_560);
        client.wakeBuffer = remaining.length ? [remaining] : [];
        client.wakeBytes = remaining.length;
        client.wakePreRoll.push(frame);
        if (client.wakePreRoll.length > 16) client.wakePreRoll.shift();
        const wakeGeneration = client.wakeGeneration;
        const result = await this.wake.detect(frame, client.sessionId, client.wakeThreshold, client.wakeVerifier);
        if (wakeGeneration !== client.wakeGeneration) continue;
        if (result.detected) {
          const tail = Buffer.concat(client.wakeBuffer);
          client.wakeBuffer = []; client.wakeBytes = 0;
          client.state = 'wake_detected';
          client.audio = [...client.wakePreRoll, tail];
          client.audioBytes = client.audio.reduce((total, item) => total + item.length, 0);
          client.audioStarted = true;
          client.wakePreRoll = [];
          await this.voice.event(client.sessionId, 'voice.wake.detected', { score: result.score, model: result.model, provider: this.wake.name, timestamp: result.timestamp });
          this.send(client, { type: 'wake.detected', ...result });
          await this.setState(client, 'wake_detected');
          await this.voice.event(client.sessionId, 'voice.audio.started', { preRollBytes: client.audioBytes });
          await this.setState(client, 'listening');
          await this.wake.reset(client.sessionId);
          break;
        }
        if (result.score > client.wakeThreshold * 0.6 && Date.now() - client.lastWakeRejectAt > 2_000) {
          client.lastWakeRejectAt = Date.now();
          await this.voice.event(client.sessionId, 'voice.wake.rejected', { score: result.score, model: result.model });
        }
      }
    } finally { client.wakeBusy = false; }
  }

  private async processUtterance(client: VoiceClient): Promise<void> {
    const pcm = Buffer.concat(client.audio);
    client.audio = []; client.audioBytes = 0; client.audioStarted = false;
    // Lock the in-memory state before the first database write so a repeated
    // listen.stop cannot process the same utterance twice.
    client.state = 'transcribing';
    await this.voice.event(client.sessionId, 'voice.audio.stopped', { bytes: pcm.length });
    if (pcm.length < 6_400) { await this.afterSilence(client); return; }
    const generation = ++client.generation;
    await this.setState(client, 'transcribing');
    await this.voice.event(client.sessionId, 'voice.stt.started', { provider: this.stt.name, bytes: pcm.length });
    const sttStarted = Date.now();
    const rawTranscript = await this.stt.transcribe(pcm);
    if (generation !== client.generation) return;
    const transcript = client.mode === 'wake' ? this.withoutWakeWord(rawTranscript, client.wakeKeyword) : rawTranscript;
    await this.voice.event(client.sessionId, 'voice.stt.completed', { transcript, latencyMs: Date.now() - sttStarted });
    this.send(client, { type: 'transcript', text: transcript });
    if (!transcript) { await this.afterSilence(client); return; }
    await this.setState(client, 'thinking');
    await this.voice.event(client.sessionId, 'voice.thinking.started');
    const thinkingStarted = Date.now();
    const result = await this.conversations.addMessageToConversation(client.conversationId, transcript, { inputMode: 'voice', outputMode: 'voice' });
    if (generation !== client.generation) return;
    await this.voice.event(client.sessionId, 'voice.thinking.completed', { latencyMs: Date.now() - thinkingStarted, userMessageId: result.messages[0].id, assistantMessageId: result.messages[1].id });
    const text = result.messages[1].content;
    this.send(client, { type: 'response', text, messages: result.messages, conversationId: result.conversationId });
    await this.setState(client, 'speaking');
    const settings = await this.settings.getApplicationSettings();
    client.ttsAbort = new AbortController();
    const usesFishAudio = settings.voiceTtsEngine === 'fish';
    const voiceId = usesFishAudio
      ? settings.fishAudioReferenceId
      : await this.voice.voiceIdForProfile(settings.voiceProfileId);
    const ttsProvider = usesFishAudio ? this.fishAudioTts
      : settings.voiceTtsEngine === 'qwen' && this.qwenTts ? this.qwenTts
        : settings.voiceTtsEngine === 'qwen-fast' && this.fasterQwenTts ? this.fasterQwenTts
          : settings.voiceTtsEngine === 'f5' && this.f5Tts ? this.f5Tts : this.tts;
    if (!ttsProvider) throw new Error('Fish Audio provider is unavailable');
    await this.voice.event(client.sessionId, 'voice.tts.started', { provider: ttsProvider.name, engine: settings.voiceTtsEngine, voice: voiceId, profileId: usesFishAudio ? null : settings.voiceProfileId });
    const ttsStarted = Date.now();
    try {
      const result = await ttsProvider.synthesize(this.forSpeech(text), voiceId, settings.voiceSpeed, client.ttsAbort.signal);
      if (generation !== client.generation) return;
      await this.voice.event(client.sessionId, 'voice.tts.chunk', { bytes: result.audio.length });
      await this.voice.event(client.sessionId, 'voice.tts.completed', { latencyMs: Date.now() - ttsStarted, bytes: result.audio.length });
      this.send(client, { type: 'audio', mimeType: result.mimeType, data: result.audio.toString('base64') });
    } catch (error) {
      if (client.ttsAbort.signal.aborted) return;
      throw error;
    } finally { client.ttsAbort = undefined; }
  }

  private async afterSilence(client: VoiceClient): Promise<void> {
    await this.setState(client, client.mode === 'wake' ? 'idle' : 'listening');
  }

  private async finishResponse(client: VoiceClient): Promise<void> {
    client.wakeBuffer = []; client.wakeBytes = 0; client.wakePreRoll = [];
    await this.setState(client, client.mode === 'wake' ? 'idle' : 'listening');
    if (client.mode === 'wake') await this.wake.reset(client.sessionId);
  }

  private async resetWake(client: VoiceClient): Promise<void> {
    client.wakeGeneration += 1;
    client.wakeBuffer = []; client.wakeBytes = 0; client.wakePreRoll = [];
    await this.wake.reset(client.sessionId);
  }

  private withoutWakeWord(transcript: string, keyword: string): string {
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    // A model score is only a candidate wake. Require Portuguese STT to confirm
    // the keyword before a candidate can submit anything to the conversation.
    // Whisper sometimes hears the isolated wake word as "Lunas".
    const boundary = new RegExp(`^\\s*${escaped}s?(?=$|[\\s,!.?:;])`, 'iu');
    if (!boundary.test(transcript)) return '';
    const prefix = new RegExp(`^\\s*${escaped}s?(?:[\\s,!.?:;]+|$)`, 'iu');
    return transcript.replace(prefix, '').trim();
  }

  private forSpeech(text: string): string {
    // Keep linked source names audible while leaving the full Markdown and
    // URLs in the persisted Conversation response.
    return text
      .replace(/\[([^\]]+)\]\(https?:\/\/[^\s)]+\)/giu, '$1')
      .replace(/https?:\/\/\S+/giu, '')
      .replace(/[*_`#]/gu, '')
      .replace(/\s+/gu, ' ')
      .trim();
  }

  private async fail(client: VoiceClient, error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    this.logger.error(`Voice session ${client.sessionId}: ${message}`);
    client.ttsAbort?.abort();
    try {
      await this.voice.event(client.sessionId, 'voice.error', { message });
      await this.setState(client, 'error');
    } catch (recordError) {
      this.logger.error(`Could not persist voice error: ${recordError instanceof Error ? recordError.message : String(recordError)}`);
    }
    this.send(client, { type: 'error', message });
  }
}
