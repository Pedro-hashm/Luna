import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as next } from 'node:timers/promises';
import { downsampleDiscordPcm, VoiceRoom, wakeChime, withoutWakeWord } from './voice-room.mjs';
import { createProviders, localBase, pcmWave, readControlSettings } from './providers.mjs';

function frame(value) {
  const pcm = Buffer.alloc(2_560);
  for (let i = 0; i < pcm.length; i += 2) pcm.writeInt16LE(value, i);
  return pcm;
}

function setup(overrides = {}) {
  let time = 0;
  const events = [];
  const providers = {
    detect: async () => true,
    reset: async () => {},
    transcribe: async pcm => { events.push({ pcm }); return 'Luna, tudo bem?'; },
    answer: async (command, context) => { events.push({ command, context }); return Buffer.from('audio'); },
    ...overrides,
  };
  const room = new VoiceRoom({
    providers,
    now: () => time,
    playCue: async () => events.push('cue'),
    playReply: async () => events.push('reply'),
    stopPlayback: () => events.push('stop'),
  });
  return {
    events,
    room,
    advance(ms) { time += ms; },
  };
}

test('first confirmed user owns the cue and command despite overlap', async () => {
  const pending = [];
  const { events, room, advance } = setup({ detect: () => new Promise(resolve => pending.push(resolve)) });
  room.add('alice');
  room.add('bob');
  room.receive('guest', frame(7_000));
  room.receive('bob', frame(-7_000));
  room.receive('alice', frame(5_000));
  assert.equal(pending.length, 2);
  pending[1](true);
  await next();
  pending[0](true);
  await next();
  assert.deepEqual(events, ['cue']);
  for (let i = 0; i < 4; i++) {
    advance(80);
    room.receive('bob', frame(-7_000));
    room.receive('alice', frame(5_000));
  }
  advance(950);
  room.tick();
  await next();
  assert.equal(events.filter(event => event === 'reply').length, 1);
  const { pcm } = events.find(event => event.pcm);
  assert.equal(pcm.length, 5 * 2_560);
  for (let i = 0; i < pcm.length; i += 2) assert.equal(pcm.readInt16LE(i), 5_000);
});

test('Wake alone times out without triggering a model reply', async () => {
  let first = true;
  const { events, room, advance } = setup({
    transcribe: async () => {
      if (!first) return 'Luna, tudo bem?';
      first = false;
      return 'Luna.';
    },
  });
  room.add('alice');
  room.receive('alice', frame(5_000));
  await next();
  advance(5_200);
  room.tick();
  await next();
  assert.deepEqual(events, ['cue']);
  assert.equal(room.turn, undefined);
  room.receive('alice', frame(5_000));
  await next();
  for (let i = 0; i < 3; i++) {
    advance(80);
    room.receive('alice', frame(5_000));
  }
  advance(950);
  room.tick();
  await next();
  assert.equal(events.filter(event => event === 'cue').length, 2);
  assert.equal(events.filter(event => event === 'reply').length, 1);
});

test('a pause after the cue preserves the capture window and only shares own context', async () => {
  const { events, room, advance } = setup();
  room.add('alice');
  room.add('bob');
  room.receive('alice', frame(5_000));
  await next();
  advance(1_700);
  room.tick();
  assert.deepEqual(events, ['cue']);
  for (let i = 0; i < 3; i++) {
    advance(80);
    room.receive('alice', frame(5_000));
  }
  advance(950);
  room.tick();
  await next();
  assert.equal(events.filter(event => event === 'reply').length, 1);
  room.receive('bob', frame(4_000));
  await next();
  for (let i = 0; i < 3; i++) {
    advance(80);
    room.receive('bob', frame(4_000));
  }
  advance(950);
  room.tick();
  await next();
  assert.deepEqual(events.filter(event => event.command).map(event => event.context.userId), ['alice', 'bob']);
});

test('chat wake plays the cue before capturing one turn and removes its temporary listener', async () => {
  const { events, room, advance } = setup();
  room.onTemporaryEnd = userId => events.push({ temporaryEnd: userId });
  assert.equal(room.listenOnce('alice', { guildId: '42', conversationSessionId: 'call-1', username: 'Alice' }), true);
  assert.equal(room.turn.phase, 'cue');
  await room.turn.cue;
  assert.equal(room.turn.phase, 'capture');
  for (let i = 0; i < 3; i++) {
    advance(80);
    room.receive('alice', frame(5_000));
  }
  advance(950);
  room.tick();
  await next();
  assert.deepEqual(events.filter(event => typeof event === 'string'), ['cue', 'reply']);
  const requestContext = events.find(event => event.command).context;
  assert.equal(requestContext.guildId, '42');
  assert.equal(requestContext.conversationSessionId, 'call-1');
  assert.equal(requestContext.username, 'Alice');
  assert.equal(requestContext.userId, 'alice');
  assert.match(requestContext.voiceSessionId, /^[0-9a-f-]{36}$/u);
  assert.equal(events.find(event => event.temporaryEnd).temporaryEnd, 'alice');
  assert.equal(room.has('alice'), false);
});

test('chat wake preserves an existing wake-word opt-in after its one turn', async () => {
  const { room, advance } = setup();
  room.add('alice', { requestContext: { guildId: '42' } });
  assert.equal(room.listenOnce('alice', { guildId: '42', conversationSessionId: 'call-1' }), true);
  await room.turn.cue;
  for (let i = 0; i < 3; i++) {
    advance(80);
    room.receive('alice', frame(5_000));
  }
  advance(950);
  room.tick();
  await next();
  assert.equal(room.has('alice'), true);
});

test('leaving while STT is running cancels reply and discards participant context', async () => {
  let finish;
  let cancelled;
  const { events, room, advance } = setup({
    transcribe: async (_pcm, signal) => {
      cancelled = signal;
      return await new Promise(resolve => { finish = resolve; });
    },
  });
  room.add('alice');
  room.receive('alice', frame(5_000));
  await next();
  advance(5_200);
  room.tick();
  room.remove('alice');
  assert.equal(cancelled.aborted, true);
  assert.equal(room.has('alice'), false);
  finish('Luna, diga algo.');
  await next();
  assert.deepEqual(events, ['cue', 'stop']);
});

test('worker configuration accepts only valid selected IDs and local provider URLs', () => {
  assert.deepEqual(readControlSettings({ enabled: true, guildId: '42', channelId: '99' }),
    { enabled: true, guildId: '42', channelId: '99' });
  assert.throws(() => readControlSettings({ enabled: true, guildId: '42', channelId: null }));
  assert.throws(() => readControlSettings({ enabled: false, guildId: '18446744073709551616', channelId: null }));
  assert.throws(() => localBase('https://discord.com'));
  assert.throws(() => localBase('http://user@api'));
  assert.throws(() => localBase('http://speaches:8000/private'));
  assert.equal(localBase('http://speaches:8000'), 'http://speaches:8000');
});

test('Discord voice forwards the transcript to the authenticated Luna runtime for speech synthesis', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url: String(url), options };
    return new Response(Buffer.from('mp3-audio'), { headers: { 'content-type': 'audio/mpeg' } });
  };
  const providers = createProviders({
    LUNA_API_URL: 'http://api:8000',
    DISCORD_VOICE_WORKER_SECRET: 'worker-secret',
  });
  const audio = await providers.answer('Qual é o meu jogo favorito?', {
    guildId: '42', userId: '99', conversationSessionId: 'call-uuid',
    username: 'Pedro', voiceSessionId: 'voice-uuid',
  });
  assert.equal(request.url, 'http://api:8000/discord-voice/worker/turn');
  assert.equal(request.options.headers.authorization, 'Bearer worker-secret');
  assert.deepEqual(JSON.parse(request.options.body), {
    guildId: '42', userId: '99', sessionId: 'call-uuid', username: 'Pedro',
    transcript: 'Qual é o meu jogo favorito?',
  });
  assert.deepEqual(audio, Buffer.from('mp3-audio'));
});

test('PCM conversion, cue and keyword parsing keep the voice contract', () => {
  const sample = Buffer.alloc(12);
  for (let i = 0; i < sample.length; i += 2) sample.writeInt16LE(i * 100, i);
  assert.equal(downsampleDiscordPcm(sample).readInt16LE(), 500);
  assert.equal(wakeChime().length, 40_320);
  const wave = pcmWave(frame(1_000));
  assert.equal(wave.readUInt32LE(24), 16_000);
  assert.equal(wave.readUInt16LE(22), 1);
  assert.equal(wave.readUInt32LE(40), 2_560);
  assert.equal(withoutWakeWord('Luna, diga oi.'), 'diga oi.');
  assert.equal(withoutWakeWord('aluna passou'), undefined);
  assert.equal(withoutWakeWord('Luna.'), '');
});

