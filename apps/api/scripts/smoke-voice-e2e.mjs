/**
 * Live API pipeline smoke: text -> same Conversation voice -> text.
 * Run from the host with `node apps/api/scripts/smoke-voice-e2e.mjs` while
 * Compose is up. Uses Kokoro to make a deterministic microphone WAV sample.
 */
import { spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import WebSocket from 'ws';

const api = (process.env.API_URL ?? 'http://localhost:8000').replace(/\/$/, '');
const kokoro = (process.env.KOKORO_URL ?? 'http://localhost:8002').replace(/\/$/, '');
const wsBase = api.replace(/^http/, 'ws');

async function json(path, init) {
  const response = await fetch(`${api}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
  });
  const body = await response.json().catch(() => undefined);
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status} ${JSON.stringify(body)}`);
  return body;
}

async function makePcm(utterance) {
  const response = await fetch(`${kokoro}/v1/audio/speech`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'kokoro', input: utterance, voice: 'pf_dora', response_format: 'wav' }),
  });
  if (!response.ok) throw new Error(`Kokoro: HTTP ${response.status} ${await response.text()}`);
  const wav = Buffer.from(await response.arrayBuffer());
  const converted = spawnSync('ffmpeg', ['-v', 'error', '-f', 'wav', '-i', 'pipe:0', '-f', 's16le', '-ac', '1', '-ar', '16000', 'pipe:1'], {
    input: wav,
    maxBuffer: 10_000_000,
  });
  if (converted.status !== 0 || !converted.stdout.length) {
    throw new Error(`ffmpeg failed: ${converted.stderr?.toString()}`);
  }
  return converted.stdout;
}

function openSocket(sessionId) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`${wsBase}/voice/ws?sessionId=${encodeURIComponent(sessionId)}`);
    const events = [];
    const waiters = [];
    socket.once('error', reject);
    socket.on('message', (raw) => {
      let event;
      try { event = JSON.parse(raw.toString()); }
      catch { return; }
      events.push(event);
      for (const waiter of [...waiters]) {
        if (waiter.predicate(event)) {
          clearTimeout(waiter.timer);
          waiters.splice(waiters.indexOf(waiter), 1);
          waiter.resolve(event);
        }
      }
    });
    socket.once('open', () => resolve({
      socket,
      events,
      wait(predicate, ms = 180_000) {
        const prior = events.find(predicate);
        if (prior) return Promise.resolve(prior);
        return new Promise((resolveWait, rejectWait) => {
          const waiter = { predicate, resolve: resolveWait, timer: undefined };
          waiter.timer = setTimeout(() => {
            waiters.splice(waiters.indexOf(waiter), 1);
            rejectWait(new Error(`Voice WS timeout; events=${JSON.stringify(events).slice(-1000)}`));
          }, ms);
          waiters.push(waiter);
        });
      },
    }));
  });
}

async function main() {
  const before = await json('/conversation');
  const textBefore = await json('/conversation/messages', {
    method: 'POST',
    body: JSON.stringify({ content: 'Guarde neste contexto de teste: o nome da nave fictícia é Aurora Sete.' }),
  });
  const conversationId = textBefore.conversationId;
  const session = await json('/voice/sessions', {
    method: 'POST',
    body: JSON.stringify({ conversationId, mode: 'live' }),
  });
  const client = await openSocket(session.id);
  try {
    await client.wait((event) => event.type === 'state');
    client.socket.send(JSON.stringify({ type: 'listen.start' }));
    await client.wait((event) => event.type === 'state' && event.state === 'listening');
    const pcm = await makePcm('Qual é o nome da nave fictícia que eu pedi para guardar?');
    for (let i = 0; i < pcm.length; i += 10240) {
      client.socket.send(pcm.subarray(i, i + 10240));
      await delay(25);
    }
    await delay(500);
    client.socket.send(JSON.stringify({ type: 'listen.stop' }));
    const transcript = await client.wait((event) => event.type === 'transcript');
    const answer = await client.wait((event) => event.type === 'response');
    const audio = await client.wait((event) => event.type === 'audio');
    if (!audio.data || Buffer.from(audio.data, 'base64').length < 1000) {
      throw new Error('TTS audio was empty');
    }
    client.socket.send(JSON.stringify({ type: 'playback.complete' }));
    await client.wait((event) => event.type === 'state' && event.state === 'listening' && client.events.indexOf(event) > client.events.indexOf(answer));

    const afterVoice = await json(`/conversation/${conversationId}`);
    const voiceMessages = afterVoice.messages.filter((message) => message.inputMode === 'voice' || message.outputMode === 'voice');
    if (voiceMessages.length !== 2) throw new Error(`Expected one voice user/assistant pair, got ${voiceMessages.length}`);
    if (answer.conversationId !== conversationId || session.conversationId !== conversationId) throw new Error('Voice created a different Conversation');

    const textAfter = await json(`/conversation/${conversationId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ content: 'Responda em texto: qual era o nome da nave fictícia?' }),
    });
    if (textAfter.conversationId !== conversationId) throw new Error('Text continuation changed Conversation');
    if (!/aurora[\s,.;:!-]+sete/iu.test(textAfter.messages[1].content)) {
      throw new Error(`Text continuation lost the shared context: ${textAfter.messages[1].content}`);
    }
    client.socket.close();
    await json(`/voice/sessions/${session.id}/end`, { method: 'POST' });

    // Reopen voice after text in a second VoiceSession on the same Conversation.
    const secondSession = await json('/voice/sessions', {
      method: 'POST', body: JSON.stringify({ conversationId, mode: 'live' }),
    });
    const secondClient = await openSocket(secondSession.id);
    let secondAnswer;
    try {
      await secondClient.wait((event) => event.type === 'state');
      secondClient.socket.send(JSON.stringify({ type: 'listen.start' }));
      await secondClient.wait((event) => event.type === 'state' && event.state === 'listening');
      const secondPcm = await makePcm('Repita o nome da nave fictícia desta conversa.');
      for (let i = 0; i < secondPcm.length; i += 10240) {
        secondClient.socket.send(secondPcm.subarray(i, i + 10240));
        await delay(25);
      }
      await delay(500);
      secondClient.socket.send(JSON.stringify({ type: 'listen.stop' }));
      secondAnswer = await secondClient.wait((event) => event.type === 'response');
      const secondAudio = await secondClient.wait((event) => event.type === 'audio');
      if (!secondAudio.data || Buffer.from(secondAudio.data, 'base64').length < 1000) throw new Error('Second voice audio was empty');
      secondClient.socket.send(JSON.stringify({ type: 'playback.complete' }));
      if (secondAnswer.conversationId !== conversationId || secondSession.conversationId !== conversationId) {
        throw new Error('Second VoiceSession changed Conversation');
      }
      if (!/aurora[\s,.;:!-]+sete/iu.test(secondAnswer.text)) {
        throw new Error(`Second voice turn lost the shared context: ${secondAnswer.text}`);
      }
    } finally {
      secondClient.socket.close();
      await json(`/voice/sessions/${secondSession.id}/end`, { method: 'POST' }).catch(() => undefined);
    }
    const after = await json('/conversation');
    if (after.length !== before.length + 1) throw new Error(`Conversation count changed by ${after.length - before.length}, expected 1`);
    const sameConversationSessions = await json(`/voice/sessions?conversationId=${conversationId}`);
    if (sameConversationSessions.length !== 2 || sameConversationSessions.some((item) => !item.endedAt)) {
      throw new Error(`Expected two ended VoiceSessions on one Conversation: ${JSON.stringify(sameConversationSessions)}`);
    }
    const completeConversation = await json(`/conversation/${conversationId}`);
    if (completeConversation.messages.filter((message) => message.inputMode === 'voice' || message.outputMode === 'voice').length !== 4) {
      throw new Error('Expected both voice turns in the shared Conversation history');
    }
    const events = await json(`/voice/sessions/${session.id}/events`);
    const eventTypes = new Set(events.events.map((event) => event.type));
    for (const type of ['voice.stt.completed', 'voice.thinking.completed', 'voice.tts.completed']) {
      if (!eventTypes.has(type)) throw new Error(`Missing voice event ${type}`);
    }
    console.log(JSON.stringify({
      passed: true, conversationId, voiceSessionIds: [session.id, secondSession.id],
      transcript: transcript.text, voiceResponse: answer.text,
      textResponse: textAfter.messages[1].content, secondVoiceResponse: secondAnswer.text,
      ttsBytes: Buffer.from(audio.data, 'base64').length,
      voiceMessageIds: voiceMessages.map((message) => message.id),
      eventTypes: [...eventTypes],
    }, null, 2));
  } finally {
    client.socket.close();
    await json(`/voice/sessions/${session.id}/end`, { method: 'POST' }).catch(() => undefined);
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
