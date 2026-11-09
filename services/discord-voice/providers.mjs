const localHosts = new Set([
  'api', 'localhost', '127.0.0.1', 'host.docker.internal', '[::1]',
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

export function createProviders(env = process.env) {
  const api = localBase(env.LUNA_API_URL || 'http://api:8000');
  const secret = (env.DISCORD_VOICE_WORKER_SECRET || '').trim();

  return {
    async answer(query, context, signal) {
      if (!secret) throw new Error('worker_auth');
      const response = await fetch(api + '/discord-voice/worker/turn', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + secret },
        redirect: 'error',
        signal: AbortSignal.any([signal, AbortSignal.timeout(180_000)]),
        body: JSON.stringify({
          guildId: context.guildId,
          userId: context.userId,
          sessionId: context.conversationSessionId,
          username: context.username,
          transcript: query,
          inputMode: 'text',
        }),
      });
      if (!response.ok) throw new Error('turn');
      const audio = Buffer.from(await response.arrayBuffer());
      if (!audio.length || audio.length > 24 * 1024 * 1024) throw new Error('turn_audio');
      return audio;
    },
  };
}

