import { once } from 'node:events';
import { createServer, type Server } from 'node:http';
import { WebSocket } from 'ws';
import { VoiceGateway } from './voice.gateway';

const SESSION_ID = '22222222-2222-4222-8222-222222222222';
const CONVERSATION_ID = '11111111-1111-4111-8111-111111111111';

type WireMessage = { type?: string; state?: string; mode?: string; text?: string; message?: string; data?: string };

async function waitUntil(check: () => boolean, label: string): Promise<void> {
  const deadline = Date.now() + 3_000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function harness(mode: 'live' | 'wake' = 'live') {
  const events: Array<{ type: string; data?: unknown }> = [];
  const voice = {
    getSession: jest.fn().mockResolvedValue({ id: SESSION_ID, conversationId: CONVERSATION_ID, mode, endedAt: null }),
    state: jest.fn().mockResolvedValue(undefined),
    event: jest.fn().mockImplementation((_id: string, type: string, data?: unknown) => { events.push({ type, data }); return Promise.resolve(); }),
    voiceIdForProfile: jest.fn().mockResolvedValue('pf_dora'),
    endSession: jest.fn().mockResolvedValue({ id: SESSION_ID, endedAt: new Date() }),
    changeMode: jest.fn().mockResolvedValue({ id: SESSION_ID }),
    expireStaleSessions: jest.fn().mockResolvedValue(0),
  };
  const settings = { getApplicationSettings: jest.fn().mockResolvedValue({
    voiceEnabled: true, wakeEnabled: true,
    wakeThreshold: 0.5, wakeKeyword: 'Luna', wakeVerifierEnabled: false, wakeVerifierModel: null,
    wakeVerifierThreshold: 0.5, voiceBargeInEnabled: true, voiceProfileId: 'pf_dora', voiceSpeed: 1,
  }) };
  const conversations = { addMessageToConversation: jest.fn().mockImplementation(async (id: string, transcript: string) => ({
    conversationId: id,
    messages: [{ id: `user-${transcript}`, content: transcript }, { id: `assistant-${transcript}`, content: `Resposta: ${transcript}` }],
  })) };
  const wake = { name: 'openWakeWord', detect: jest.fn().mockResolvedValue({ detected: false, score: 0.01, model: 'luna', timestamp: Date.now() }), reset: jest.fn().mockResolvedValue(undefined) };
  const stt = { name: 'speaches', transcribe: jest.fn().mockResolvedValue('primeira pergunta') };
  const tts = { name: 'kokoro', synthesize: jest.fn().mockResolvedValue({ audio: Buffer.from('ID3audio'), mimeType: 'audio/mpeg' }) };
  const gateway = new VoiceGateway(voice as never, conversations as never, settings as never, wake as never, stt as never, tts as never);
  const server: Server = createServer();
  gateway.attach(server);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No test server address');
  const socket = new WebSocket(`ws://127.0.0.1:${address.port}/voice/ws?sessionId=${SESSION_ID}`);
  const messages: WireMessage[] = [];
  socket.on('message', (data) => { messages.push(JSON.parse(data.toString()) as WireMessage); });
  await once(socket, 'open');
  await waitUntil(() => messages.some((message) => message.type === 'state' && message.state === 'idle'), 'initial idle');
  const stop = async () => {
    if (socket.readyState === WebSocket.OPEN) {
      socket.close();
      await once(socket, 'close');
    }
    await new Promise<void>((resolve) => server.close(() => resolve()));
  };
  return { socket, messages, events, voice, settings, conversations, wake, stt, tts, stop };
}

describe('Voice WebSocket pipeline', () => {
  it('does not call STT, Conversation, or TTS while Wake stays idle', async () => {
    const test = await harness('wake');
    try {
      test.socket.send(Buffer.alloc(2_560), { binary: true });
      await waitUntil(() => test.wake.detect.mock.calls.length === 1, 'wake detection');
      test.socket.send(JSON.stringify({ type: 'listen.stop' }));
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(test.stt.transcribe).not.toHaveBeenCalled();
      expect(test.conversations.addMessageToConversation).not.toHaveBeenCalled();
      expect(test.tts.synthesize).not.toHaveBeenCalled();
      expect(test.messages.some((message) => message.state === 'idle')).toBe(true);
    } finally { await test.stop(); }
  });

  it('processes a repeated listen.stop only once', async () => {
    const test = await harness('live');
    try {
      test.socket.send(JSON.stringify({ type: 'listen.start' }));
      await waitUntil(() => test.messages.some((message) => message.state === 'listening'), 'listening');
      test.socket.send(Buffer.alloc(8_000), { binary: true });
      test.socket.send(JSON.stringify({ type: 'listen.stop' }));
      test.socket.send(JSON.stringify({ type: 'listen.stop' }));
      await waitUntil(() => test.messages.some((message) => message.type === 'audio'), 'TTS audio');
      expect(test.stt.transcribe).toHaveBeenCalledTimes(1);
      expect(test.conversations.addMessageToConversation).toHaveBeenCalledTimes(1);
    } finally { await test.stop(); }
  });

  it('keeps its original mode when a mode change is rejected', async () => {
    const test = await harness('live');
    try {
      test.voice.changeMode.mockRejectedValue(new Error('Wake mode is disabled'));
      test.socket.send(JSON.stringify({ type: 'mode.set', mode: 'wake' }));
      await waitUntil(() => test.messages.some((message) => message.type === 'error'), 'mode change error');
      expect(test.voice.changeMode).toHaveBeenCalledWith(SESSION_ID, 'wake');
      expect(test.messages.filter((message) => message.type === 'state').pop()?.state).toBe('error');
      expect(test.messages.filter((message) => message.type === 'state').pop()?.mode).toBe('live');
    } finally { await test.stop(); }
  });

  it('keeps two Live turns in one Conversation and persists voice modes', async () => {
    const test = await harness('live');
    try {
      test.stt.transcribe.mockResolvedValueOnce('primeira pergunta').mockResolvedValueOnce('segunda pergunta');
      for (const transcript of ['primeira pergunta', 'segunda pergunta']) {
        const start = test.messages.length;
        test.socket.send(JSON.stringify({ type: 'listen.start' }));
        await waitUntil(() => test.messages.slice(start).some((message) => message.state === 'listening'), 'listening');
        test.socket.send(Buffer.alloc(8_000), { binary: true });
        test.socket.send(JSON.stringify({ type: 'listen.stop' }));
        await waitUntil(() => test.messages.slice(start).some((message) => message.type === 'audio'), 'TTS audio');
        expect(test.messages.slice(start).some((message) => message.type === 'transcript' && message.text === transcript)).toBe(true);
        test.socket.send(JSON.stringify({ type: 'playback.complete' }));
        await waitUntil(() => test.messages.slice(start).filter((message) => message.state === 'listening').length >= 2, 'next Live listening');
      }
      expect(test.conversations.addMessageToConversation).toHaveBeenCalledTimes(2);
      for (const call of test.conversations.addMessageToConversation.mock.calls) {
        expect(call[0]).toBe(CONVERSATION_ID);
        expect(call[2]).toEqual({ inputMode: 'voice', outputMode: 'voice' });
      }
      expect(test.events.filter((event) => event.type === 'voice.thinking.completed')).toHaveLength(2);
    } finally { await test.stop(); }
  });

  it('cancels active Kokoro synthesis on barge-in and resumes listening', async () => {
    const test = await harness('live');
    try {
      test.tts.synthesize.mockImplementation((_text, _voice, _speed, signal: AbortSignal) => new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true });
      }));
      test.socket.send(JSON.stringify({ type: 'listen.start' }));
      await waitUntil(() => test.messages.some((message) => message.state === 'listening'), 'listening');
      test.socket.send(Buffer.alloc(8_000), { binary: true });
      test.socket.send(JSON.stringify({ type: 'listen.stop' }));
      await waitUntil(() => test.tts.synthesize.mock.calls.length === 1, 'Kokoro synthesis');
      test.socket.send(JSON.stringify({ type: 'barge_in' }));
      await waitUntil(() => test.messages.some((message) => message.type === 'audio.cancel'), 'audio cancel');
      await waitUntil(() => test.messages.filter((message) => message.state === 'listening').length >= 2, 'listening after barge-in');
      expect(test.events.some((event) => event.type === 'voice.barge_in')).toBe(true);
      expect((test.tts.synthesize.mock.calls[0][3] as AbortSignal).aborted).toBe(true);
    } finally { await test.stop(); }
  });

  it('reports wake offline without starting STT or Conversation processing', async () => {
    const test = await harness('wake');
    try {
      test.wake.detect.mockRejectedValue(new Error('openWakeWord is unavailable'));
      test.socket.send(Buffer.alloc(2_560), { binary: true });
      await waitUntil(() => test.messages.some((message) => message.type === 'error'), 'wake error');
      expect(test.messages.find((message) => message.type === 'error')?.message).toContain('openWakeWord');
      expect(test.stt.transcribe).not.toHaveBeenCalled();
      expect(test.conversations.addMessageToConversation).not.toHaveBeenCalled();
    } finally { await test.stop(); }
  });

  it('reports Speaches failure and avoids creating conversation messages', async () => {
    const test = await harness('live');
    try {
      test.stt.transcribe.mockRejectedValue(new Error('speaches is unavailable or timed out'));
      test.socket.send(JSON.stringify({ type: 'listen.start' }));
      await waitUntil(() => test.messages.some((message) => message.state === 'listening'), 'listening');
      test.socket.send(Buffer.alloc(8_000), { binary: true });
      test.socket.send(JSON.stringify({ type: 'listen.stop' }));
      await waitUntil(() => test.messages.some((message) => message.type === 'error'), 'STT error');
      expect(test.messages.find((message) => message.type === 'error')?.message).toContain('speaches');
      expect(test.conversations.addMessageToConversation).not.toHaveBeenCalled();
      expect(test.tts.synthesize).not.toHaveBeenCalled();
    } finally { await test.stop(); }
  });

  it('reports Kokoro failure after the generated response is persisted', async () => {
    const test = await harness('live');
    try {
      test.tts.synthesize.mockRejectedValue(new Error('kokoro is unavailable or timed out'));
      test.socket.send(JSON.stringify({ type: 'listen.start' }));
      await waitUntil(() => test.messages.some((message) => message.state === 'listening'), 'listening');
      test.socket.send(Buffer.alloc(8_000), { binary: true });
      test.socket.send(JSON.stringify({ type: 'listen.stop' }));
      await waitUntil(() => test.messages.some((message) => message.type === 'error'), 'TTS error');
      expect(test.messages.some((message) => message.type === 'response')).toBe(true);
      expect(test.messages.find((message) => message.type === 'error')?.message).toContain('kokoro');
      expect(test.conversations.addMessageToConversation).toHaveBeenCalledTimes(1);
    } finally { await test.stop(); }
  });

  it.each(['LLM timed out', 'Search timed out'])('reports %s without starting TTS', async (failure) => {
    const test = await harness('live');
    try {
      test.conversations.addMessageToConversation.mockRejectedValue(new Error(failure));
      test.socket.send(JSON.stringify({ type: 'listen.start' }));
      await waitUntil(() => test.messages.some((message) => message.state === 'listening'), 'listening');
      test.socket.send(Buffer.alloc(8_000), { binary: true });
      test.socket.send(JSON.stringify({ type: 'listen.stop' }));
      await waitUntil(() => test.messages.some((message) => message.type === 'error'), 'orchestrator error');
      expect(test.messages.some((message) => message.type === 'transcript')).toBe(true);
      expect(test.messages.find((message) => message.type === 'error')?.message).toContain(failure);
      expect(test.messages.some((message) => message.type === 'audio')).toBe(false);
      expect(test.tts.synthesize).not.toHaveBeenCalled();
      expect(test.events.some((event) => event.type === 'voice.error')).toBe(true);
    } finally { await test.stop(); }
  });

  it('reports an invalid selected profile after preserving the text response', async () => {
    const test = await harness('live');
    try {
      test.voice.voiceIdForProfile.mockRejectedValue(new Error('Selected voice profile not found'));
      test.socket.send(JSON.stringify({ type: 'listen.start' }));
      await waitUntil(() => test.messages.some((message) => message.state === 'listening'), 'listening');
      test.socket.send(Buffer.alloc(8_000), { binary: true });
      test.socket.send(JSON.stringify({ type: 'listen.stop' }));
      await waitUntil(() => test.messages.some((message) => message.type === 'error'), 'profile error');
      expect(test.messages.some((message) => message.type === 'response')).toBe(true);
      expect(test.messages.find((message) => message.type === 'error')?.message).toContain('profile');
      expect(test.tts.synthesize).not.toHaveBeenCalled();
    } finally { await test.stop(); }
  });
});
