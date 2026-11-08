import { randomUUID } from 'node:crypto';

const bytesPerMs = 32;
const frameBytes = 80 * bytesPerMs;
const wakeFrames = 16;
const maxPendingBytes = 24 * frameBytes;
const maximumCaptureMs = 20_000;
const commandWaitMs = 5_000;
const silenceMs = 900;
const minimumSpeechMs = 180;
const wakeTailMs = 240;

export function downsampleDiscordPcm(input) {
  const frames = Math.floor(input.length / 12);
  const output = Buffer.alloc(frames * 2);
  for (let frame = 0; frame < frames; frame++) {
    const position = frame * 12;
    let sum = 0;
    for (let offset = 0; offset < 12; offset += 2) sum += input.readInt16LE(position + offset);
    output.writeInt16LE(Math.round(sum / 6), frame * 2);
  }
  return output;
}

export function wakeChime() {
  const samples = Math.round(48_000 * 0.21);
  const pcm = Buffer.alloc(samples * 4);
  let phase = 0;
  for (let i = 0; i < samples; i++) {
    const elapsed = i / 48_000;
    const frequency = 660 + 220 * Math.min(1, elapsed / 0.14);
    const gain = Math.max(0, Math.min(elapsed / 0.015, (0.20 - elapsed) / 0.185, 1)) * 0.1;
    const sample = Math.round(Math.sin(phase) * gain * 32_767);
    pcm.writeInt16LE(sample, i * 4);
    pcm.writeInt16LE(sample, i * 4 + 2);
    phase += 2 * Math.PI * frequency / 48_000;
  }
  return pcm;
}

export function withoutWakeWord(transcript) {
  const prefix = /^\s*["“']?lunas?(?=$|[\s,.!?:;"”'…\-])[\s,.!?:;"”'…\-]*/iu;
  return prefix.test(transcript) ? transcript.replace(prefix, '').trim() : undefined;
}

function speech(pcm) {
  let squareSum = 0;
  for (let index = 0; index < pcm.length; index += 2) squareSum += pcm.readInt16LE(index) ** 2;
  return squareSum / (pcm.length / 2) > (0.014 * 32_768) ** 2;
}

function voicedDuration(pcm) {
  const packetBytes = 20 * bytesPerMs;
  let duration = 0;
  for (let offset = 0; offset < pcm.length; offset += packetBytes) {
    const packet = pcm.subarray(offset, offset + packetBytes);
    if (speech(packet)) duration += packet.length / bytesPerMs;
  }
  return duration;
}

function clearWake(speaker) {
  speaker.pending = Buffer.alloc(0);
  speaker.preRoll = [];
  speaker.generation++;
  speaker.resetBefore = true;
}

export class VoiceRoom {
  constructor({ providers, playCue, playReply, stopPlayback, onTemporaryEnd = () => {}, log = () => {}, now = () => performance.now(), limit = 4 }) {
    this.providers = providers;
    this.playCue = playCue;
    this.playReply = playReply;
    this.stopPlayback = stopPlayback;
    this.onTemporaryEnd = onTemporaryEnd;
    this.log = log;
    this.now = now;
    this.limit = limit;
    this.speakers = new Map();
    this.turn = undefined;
  }

  add(userId, options = {}) {
    if (this.speakers.has(userId)) {
      const existing = this.speakers.get(userId);
      if (options.temporary !== true) existing.temporary = false;
      if (options.requestContext) existing.requestContext = options.requestContext;
      return true;
    }
    if (this.speakers.size >= this.limit) return false;
    this.speakers.set(userId, {
      userId,
      sessionId: randomUUID(),
      requestContext: options.requestContext ?? {},
      temporary: options.temporary === true,
      controller: new AbortController(),
      pending: Buffer.alloc(0),
      preRoll: [],
      generation: 0,
      lastFrameAt: -Infinity,
      reading: false,
      resetBefore: false,
    });
    return true;
  }

  has(userId) {
    return this.speakers.has(userId);
  }

  remove(userId) {
    const speaker = this.speakers.get(userId);
    if (!speaker) return;
    this.speakers.delete(userId);
    speaker.controller.abort();
    if (!speaker.reading) void this.providers.reset(speaker.sessionId, true);
    if (speaker.temporary) this.onTemporaryEnd(userId);
    if (this.turn?.speaker === speaker) {
      const turn = this.turn;
      this.turn = undefined;
      turn.controller.abort();
      this.stopPlayback();
    }
  }

  reset() {
    for (const userId of this.speakers.keys()) this.remove(userId);
  }

  pause() {
    if (this.turn) {
      const turn = this.turn;
      this.turn = undefined;
      turn.controller.abort();
      this.stopPlayback();
    }
    for (const speaker of this.speakers.values()) {
      if (speaker.temporary) {
        this.remove(speaker.userId);
      } else {
        clearWake(speaker);
        speaker.lastFrameAt = -Infinity;
      }
    }
  }

  persistentUserIds() {
    return [...this.speakers.values()].filter(speaker => !speaker.temporary).map(speaker => speaker.userId);
  }

  finishTurn(turn) {
    if (this.turn !== turn) return;
    this.turn = undefined;
    if (turn.speaker.temporary) this.remove(turn.speaker.userId);
  }

  receive(userId, pcm) {
    const speaker = this.speakers.get(userId);
    if (!speaker || !pcm.length || pcm.length % 2 || pcm.length > 3_840) return;
    const now = this.now();
    const gap = now - speaker.lastFrameAt;
    speaker.lastFrameAt = now;
    if (this.turn) {
      if (this.turn.speaker === speaker && this.turn.phase === 'capture') this.capture(this.turn, pcm, now, gap);
      return;
    }
    if ((gap > 500 && Number.isFinite(gap)) || speaker.pending.length + pcm.length > maxPendingBytes) clearWake(speaker);
    speaker.pending = Buffer.concat([speaker.pending, pcm]);
    if (!speaker.reading && speaker.pending.length >= frameBytes) void this.detect(speaker);
  }

  async detect(speaker) {
    speaker.reading = true;
    try {
      while (!speaker.controller.signal.aborted && !this.turn && speaker.pending.length >= frameBytes) {
        const generation = speaker.generation;
        if (speaker.resetBefore) {
          speaker.resetBefore = false;
          await this.providers.reset(speaker.sessionId);
          if (speaker.generation !== generation) continue;
          if (speaker.controller.signal.aborted || this.turn) break;
        }
        const frame = speaker.pending.subarray(0, frameBytes);
        speaker.pending = speaker.pending.subarray(frameBytes);
        speaker.preRoll.push(frame);
        if (speaker.preRoll.length > wakeFrames) speaker.preRoll.shift();
        if (!await this.providers.detect(frame, speaker.sessionId, speaker.controller.signal)) continue;
        if (speaker.controller.signal.aborted || speaker.generation !== generation || this.turn ||
            this.now() - speaker.lastFrameAt > 1_500) continue;
        this.activate(speaker);
      }
    } catch {
      if (!speaker.controller.signal.aborted) {
        this.log('wake_error');
        clearWake(speaker);
      }
    } finally {
      speaker.reading = false;
      if (speaker.controller.signal.aborted) void this.providers.reset(speaker.sessionId, true);
    }
  }

  activate(speaker) {
    const started = this.now();
    const buffered = speaker.pending;
    const turn = {
      speaker, started,
      lastSpeech: started,
      voicedMs: 0,
      phase: 'capture',
      buffers: [...speaker.preRoll],
      wakeBytes: speaker.preRoll.length * frameBytes,
      controller: new AbortController(),
      requireWakeWord: true,
    };
    this.turn = turn;
    if (buffered.length) this.capture(turn, buffered, started, 0);
    for (const candidate of this.speakers.values()) clearWake(candidate);
    turn.cue = Promise.resolve().then(() => this.playCue(turn.controller.signal)).catch(() => this.log('cue_error'));
    this.log('wake_detected');
  }

  listenOnce(userId, requestContext = {}) {
    if (this.turn) return false;
    const existing = this.speakers.get(userId);
    if (!existing && !this.add(userId, { requestContext, temporary: true })) return false;
    const speaker = this.speakers.get(userId);
    speaker.requestContext = requestContext;
    const turn = {
      speaker,
      started: this.now(),
      lastSpeech: this.now(),
      voicedMs: 0,
      phase: 'cue',
      buffers: [],
      controller: new AbortController(),
      requireWakeWord: false,
    };
    this.turn = turn;
    for (const candidate of this.speakers.values()) clearWake(candidate);
    turn.cue = (async () => {
      try {
        await this.playCue(turn.controller.signal);
        if (turn.controller.signal.aborted || this.turn !== turn) return;
        turn.started = this.now();
        turn.lastSpeech = turn.started;
        turn.phase = 'capture';
      } catch {
        if (!turn.controller.signal.aborted) this.log('cue_error');
        this.finishTurn(turn);
      }
    })();
    this.log('chat_wake_requested');
    return true;
  }

  askText(userId, text, requestContext = {}) {
    if (this.turn || typeof text !== 'string' || !text.trim()) return false;
    const existing = this.speakers.get(userId);
    if (!existing && !this.add(userId, { requestContext, temporary: true })) return false;
    const speaker = this.speakers.get(userId);
    speaker.requestContext = requestContext;
    const turn = {
      speaker,
      controller: new AbortController(),
    };
    this.turn = turn;
    void (async () => {
      try {
        const audio = await this.providers.answer(text.trim(), {
          ...speaker.requestContext,
          userId: speaker.userId,
          voiceSessionId: speaker.sessionId,
          inputMode: 'text',
        }, turn.controller.signal);
        if (turn.controller.signal.aborted) return;
        await this.playReply(audio, turn.controller.signal);
        if (!turn.controller.signal.aborted) this.log('turn_complete');
      } catch {
        if (!turn.controller.signal.aborted) this.log('turn_error');
      } finally {
        this.finishTurn(turn);
      }
    })();
    this.log('chat_text_requested');
    return true;
  }

  capture(turn, pcm, now, gap) {
    if (gap > 80) turn.buffers.push(Buffer.alloc(Math.round(Math.min(400, gap) * 16) * 2));
    turn.buffers.push(pcm);
    if (speech(pcm)) {
      turn.voicedMs += pcm.length / bytesPerMs;
      turn.lastSpeech = now;
    }
  }

  tick() {
    const turn = this.turn;
    if (!turn || turn.phase !== 'capture') return;
    const now = this.now();
    const age = now - turn.started;
    const hasSpeech = turn.voicedMs >= minimumSpeechMs;
    if (age < maximumCaptureMs && (hasSpeech ? now - turn.lastSpeech < silenceMs : age < commandWaitMs)) return;
    turn.phase = 'reply';
    void this.respond(turn);
  }

  async respond(turn) {
    const signal = turn.controller.signal;
    try {
      const pcm = Buffer.concat(turn.buffers);
      turn.buffers = [];
      this.log('turn_capture_completed', { bytes: pcm.length, voicedMs: Math.round(turn.voicedMs) });
      const transcript = await this.providers.transcribe(pcm, signal);
      if (signal.aborted) return;
      this.log('turn_transcription_completed', { characters: typeof transcript === 'string' ? transcript.length : 0 });
      let command = turn.requireWakeWord ? withoutWakeWord(transcript) : transcript;
      if (turn.requireWakeWord && !command) {
        const afterWake = pcm.subarray(turn.wakeBytes);
        // The end of the wake word can overlap capture. Only retry if there
        // is enough speech beyond that tail, then exclude pre-wake audio.
        const commandVoicedMs = voicedDuration(afterWake.subarray(wakeTailMs * bytesPerMs));
        if (commandVoicedMs >= minimumSpeechMs) {
          const recovered = await this.providers.transcribe(afterWake, signal);
          command = withoutWakeWord(recovered) ?? recovered;
          this.log('turn_post_wake_transcribed', { voicedMs: Math.round(commandVoicedMs), characters: recovered.length });
        }
      }
      if (!command?.trim() || signal.aborted) {
        if (!signal.aborted) this.log('turn_skipped', { reason: transcript ? 'no_command' : 'empty_transcript' });
        return;
      }
      this.log('turn_request_started', { inputCharacters: command.length });
      const audio = await this.providers.answer(command, {
        ...turn.speaker.requestContext,
        userId: turn.speaker.userId,
        voiceSessionId: turn.speaker.sessionId,
      }, signal);
      if (signal.aborted) return;
      this.log('turn_audio_ready', { bytes: audio.length });
      await turn.cue;
      if (signal.aborted) return;
      await this.playReply(audio, signal);
      if (signal.aborted) return;
      this.log('turn_complete');
    } catch {
      if (!signal.aborted) this.log('turn_error');
    } finally {
      this.finishTurn(turn);
    }
  }
}

