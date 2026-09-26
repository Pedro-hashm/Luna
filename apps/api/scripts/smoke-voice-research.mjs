/** Run a spoken research request through STT, SearchOrchestrator and TTS. */
import { spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import WebSocket from 'ws';

const api = (process.env.API_URL ?? 'http://localhost:8000').replace(/\/$/, '');
const kokoro = (process.env.KOKORO_URL ?? 'http://localhost:8002').replace(/\/$/, '');

async function json(path, init) {
  const response = await fetch(`${api}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
  });
  const body = await response.json().catch(() => undefined);
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status} ${JSON.stringify(body)}`);
  return body;
}

async function spokenPcm(text) {
  const response = await fetch(`${kokoro}/v1/audio/speech`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'kokoro', input: text, voice: 'pf_dora', response_format: 'wav' }),
  });
  if (!response.ok) throw new Error(`Kokoro HTTP ${response.status}: ${await response.text()}`);
  const wav = Buffer.from(await response.arrayBuffer());
  const conversion = spawnSync('ffmpeg', ['-v', 'error', '-f', 'wav', '-i', 'pipe:0', '-f', 's16le', '-ac', '1', '-ar', '16000', 'pipe:1'], {
    input: wav, maxBuffer: 10_000_000,
  });
  if (conversion.status !== 0 || !conversion.stdout.length) throw new Error(`ffmpeg: ${conversion.stderr?.toString()}`);
  return conversion.stdout;
}

async function main() {
  const seed = await json('/conversation/messages', {
    method: 'POST', body: JSON.stringify({ content: 'Vamos fazer uma pesquisa rápida.' }),
  });
  const conversationId = seed.conversationId;
  const session = await json('/voice/sessions', {
    method: 'POST', body: JSON.stringify({ conversationId, mode: 'live' }),
  });
  const events = [];
  const socket = new WebSocket(`${api.replace(/^http/, 'ws')}/voice/ws?sessionId=${session.id}`);
  const wait = (predicate, timeoutMs = 300_000) => new Promise((resolve, reject) => {
    const prior = events.find(predicate);
    if (prior) return resolve(prior);
    const timer = setTimeout(() => reject(new Error(`Voice timeout: ${JSON.stringify(events).slice(-2000)}`)), timeoutMs);
    const handler = (event) => {
      if (predicate(event)) { clearTimeout(timer); socket.off('voice-event', handler); resolve(event); }
    };
    socket.on('voice-event', handler);
  });
  socket.on('message', (raw) => {
    try { const event = JSON.parse(raw.toString()); events.push(event); socket.emit('voice-event', event); }
    catch { /* binary audio is not used by this gateway */ }
  });
  try {
    await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
    await wait((event) => event.type === 'state');
    socket.send(JSON.stringify({ type: 'listen.start' }));
    await wait((event) => event.type === 'state' && event.state === 'listening');
    const pcm = await spokenPcm('Pesquise na web por que o preço da memória RAM aumentou.');
    for (let offset = 0; offset < pcm.length; offset += 10_240) {
      socket.send(pcm.subarray(offset, offset + 10_240));
      await delay(25);
    }
    await delay(500);
    socket.send(JSON.stringify({ type: 'listen.stop' }));
    const transcript = await wait((event) => event.type === 'transcript');
    const response = await wait((event) => event.type === 'response');
    const audio = await wait((event) => event.type === 'audio');
    socket.send(JSON.stringify({ type: 'playback.complete' }));
    const research = await json(`/research/conversations/${conversationId}/runs`);
    const runs = research.runs ?? research;
    const messages = (await json(`/conversation/${conversationId}`)).messages;
    const persisted = messages.filter((message) => message.inputMode === 'voice' || message.outputMode === 'voice');
    const sessionEvents = (await json(`/voice/sessions/${session.id}/events`)).events;
    if (!runs.length) throw new Error(`Voice request did not create a ResearchRun. Transcript: ${transcript.text}`);
    if (persisted.length !== 2) throw new Error(`Expected two persisted voice messages, got ${persisted.length}`);
    if (!audio.data || Buffer.from(audio.data, 'base64').length < 1000) throw new Error('TTS audio is missing');
    if (!sessionEvents.some((event) => event.type === 'voice.tts.completed')) throw new Error('Missing TTS completed event');
    console.log(JSON.stringify({ passed: true, conversationId, sessionId: session.id,
      transcript: transcript.text, response: response.text,
      researchRunIds: runs.map((run) => run.id ?? run.researchRunId),
      researchStatuses: runs.map((run) => run.status),
      voiceMessageIds: persisted.map((message) => message.id),
      ttsBytes: Buffer.from(audio.data, 'base64').length }, null, 2));
  } finally {
    socket.close();
    await json(`/voice/sessions/${session.id}/end`, { method: 'POST' }).catch(() => undefined);
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
