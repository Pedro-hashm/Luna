const localHosts = new Set([
  'api', 'wakeword', 'discord-wakeword', 'wakeword-discord', 'speaches', 'ollama', 'kokoro',
  'localhost', '127.0.0.1', 'host.docker.internal', '[::1]',
]);

export function localBase(value) {
  const url = new URL(value);
  if (url.protocol !== 'http:' || !localHosts.has(url.hostname) ||
      url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Expected a local HTTP service');
  }
  return url.origin;
}

function snowflake(id) {
  return typeof id === 'string' && /^[1-9][0-9]{0,19}$/u.test(id) && BigInt(id) <= 18_446_744_073_709_551_615n;
}

export function readControlSettings(input) {
  const { enabled, guildId, channelId } = input ?? {};
  if (typeof enabled !== 'boolean' ||
      (guildId !== null && !snowflake(guildId)) ||
      (channelId !== null && !snowflake(channelId)) ||
      (enabled && (!guildId || !channelId))) {
    throw new Error('control');
  }
  return { enabled, guildId, channelId };
}

export function pcmWave(pcm) {
  const header = Buffer.alloc(44);
  header.write('RIFF');
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(16_000, 24);
  header.writeUInt32LE(32_000, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

function requestSignal(signal, milliseconds) {
  const deadline = AbortSignal.timeout(milliseconds);
  return signal ? AbortSignal.any([signal, deadline]) : deadline;
}

async function request(stage, url, options, signal, timeoutMs) {
  try {
    const response = await fetch(url, {
      ...options, redirect: 'error', signal: requestSignal(signal, timeoutMs),
    });
    if (!response.ok) throw new Error('Unexpected HTTP status');
    return response;
  } catch {
    throw new Error(stage);
  }
}

function postJson(body) {
  return { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
}

export function createProviders(env = process.env) {
  const wake = localBase(env.WAKEWORD_BASE_URL || 'http://wakeword:8765');
  const speech = localBase(env.SPEACHES_BASE_URL || 'http://speaches:8000');
  const api = localBase(env.LUNA_API_URL || 'http://api:8000');
  const secret = (env.DISCORD_VOICE_WORKER_SECRET || '').trim();
  const threshold = Number(env.LUNA_DISCORD_WAKE_THRESHOLD || '0.65');
  if (!Number.isFinite(threshold) || threshold < 0.5 || threshold > 1) throw new Error('Invalid Wake threshold');

  return {
    async detect(frame, sessionId, signal) {
      const query = new URLSearchParams({ threshold: String(threshold), verifier_enabled: '0' });
      const response = await request('wake', wake + '/detect?' + query, {
        method: 'POST',
        headers: { 'content-type': 'application/octet-stream', 'x-voice-session-id': sessionId },
        body: frame,
      }, signal, 2_000);
      return (await response.json()).detected === true;
    },
    async reset(sessionId, release = false) {
      await request('wake_reset', wake + '/reset?release=' + (release ? '1' : '0'), {
        method: 'POST', headers: { 'x-voice-session-id': sessionId },
      }, undefined, 2_000).catch(() => undefined);
    },
    async transcribe(pcm, signal) {
      const body = new FormData();
      body.append('model', env.SPEACHES_STT_MODEL || 'Systran/faster-whisper-small');
      body.append('language', 'pt');
      body.append('file', new Blob([pcmWave(pcm)], { type: 'audio/wav' }), 'speech.wav');
      const response = await request('stt', speech + '/v1/audio/transcriptions', { method: 'POST', body }, signal, 25_000);
      const { text } = await response.json();
      if (typeof text !== 'string') throw new Error('stt');
      return text.trim().slice(0, 1_200);
    },
    async answer(text, context, signal) {
      if (!secret) throw new Error('worker_auth');
      const response = await request('turn', api + '/discord-voice/worker/turn', {
        ...postJson({
          guildId: context.guildId,
          userId: context.userId,
          sessionId: context.conversationSessionId,
          username: context.username,
          transcript: text,
        }),
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + secret },
      }, signal, 180_000);
      const audio = Buffer.from(await response.arrayBuffer());
      if (!audio.length || audio.length > 24 * 1024 * 1024) throw new Error('turn_audio');
      return audio;
    },
  };
}

