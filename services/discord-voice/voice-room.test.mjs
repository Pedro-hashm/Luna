import assert from 'node:assert/strict';
import test from 'node:test';
import { commands, readQuestion } from './commands.mjs';
import { createProviders, localBase, readControlSettings } from './providers.mjs';
import { VoiceRoom } from './voice-room.mjs';

const callId = '550e8400-e29b-41d4-a716-446655440000';
const audio = Buffer.from('mp3-audio');

function interaction(userId, query) {
  return {
    guildId: '42',
    user: { id: userId, globalName: 'Nome global', username: 'conta' },
    member: { displayName: 'Mesmo apelido' },
    options: {
      getString(name) {
        assert.equal(name, 'query');
        return query;
      },
    },
  };
}

function setup(overrides = {}) {
  const replies = [];
  const room = new VoiceRoom({
    providers: { answer: async () => audio },
    playReply: async data => replies.push(data),
    ...overrides,
  });
  return { room, replies };
}

test('the Discord command offers only enter, leave and written questions with a required query', () => {
  const { options } = commands.toJSON();
  assert.deepEqual(options.map(option => option.name), ['entrar', 'perguntar', 'sair']);
  const [query] = options.find(option => option.name === 'perguntar').options;
  assert.equal(query.name, 'query');
  assert.equal(query.required, true);
  assert.equal(query.max_length, 1_200);
  assert.equal(readQuestion(interaction('99', null), callId), undefined);
  assert.equal(readQuestion(interaction('99', '   '), callId), undefined);
  assert.equal(readQuestion(interaction('99', 'a'.repeat(1_201)), callId), undefined);
});

test('two members with the same nickname submit separate questions under their Discord IDs', async () => {
  const requests = [];
  const { room, replies } = setup({
    providers: { answer: async (text, context) => { requests.push({ text, context }); return audio; } },
  });
  assert.equal(await room.askText(readQuestion(interaction('99', ' Primeira pergunta. '), callId)), 'complete');
  assert.equal(await room.askText(readQuestion(interaction('100', 'Sou a conta 99.'), callId)), 'complete');
  assert.deepEqual(requests.map(({ text, context }) => [text, context.userId, context.username]), [
    ['Primeira pergunta.', '99', 'Mesmo apelido'],
    ['Sou a conta 99.', '100', 'Mesmo apelido'],
  ]);
  assert.ok(requests.every(({ context }) => context.conversationSessionId === callId));
  assert.deepEqual(replies, [audio, audio]);
});

test('the worker accepts one question at a time and cancels only for the author leaving', async () => {
  let resolveAudio;
  let requestSignal;
  const { room, replies } = setup({
    providers: {
      answer: async (_query, _context, signal) => {
        requestSignal = signal;
        return new Promise(resolve => { resolveAudio = resolve; });
      },
    },
  });
  const first = room.askText(readQuestion(interaction('99', 'Primeira pergunta'), callId));
  room.cancel('100');
  assert.equal(requestSignal.aborted, false);
  assert.equal(room.askText(readQuestion(interaction('100', 'Segunda pergunta'), callId)), undefined);
  room.cancel('99');
  assert.equal(requestSignal.aborted, true);
  resolveAudio(audio);
  assert.equal(await first, 'cancelled');
  assert.deepEqual(replies, []);
});

test('the worker releases the turn when synthesis fails', async () => {
  const { room, replies } = setup({
    providers: {
      answer: async (_query, { userId }) => {
        if (userId === '99') throw new Error('synthesis unavailable');
        return audio;
      },
    },
  });
  assert.equal(await room.askText(readQuestion(interaction('99', 'Primeira pergunta'), callId)), 'error');
  assert.equal(await room.askText(readQuestion(interaction('100', 'Segunda pergunta'), callId)), 'complete');
  assert.deepEqual(replies, [audio]);
});

test('worker configuration validates the configured destination and local API URL', () => {
  assert.deepEqual(readControlSettings({ enabled: true, guildId: '42', channelId: '99' }),
    { enabled: true, guildId: '42', channelId: '99' });
  assert.throws(() => readControlSettings({ enabled: true, guildId: '42', channelId: null }));
  assert.throws(() => readControlSettings({ enabled: false, guildId: '18446744073709551616', channelId: null }));
  assert.throws(() => localBase('https://discord.com'));
  assert.throws(() => localBase('http://user@api'));
  assert.throws(() => localBase('http://api:8000/private'));
  assert.equal(localBase('http://api:8000'), 'http://api:8000');
});

test('the written question and Discord identity go to Luna and its audio comes back', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url: String(url), options });
    return new Response(audio, { headers: { 'content-type': 'audio/mpeg' } });
  };
  const providers = createProviders({
    LUNA_API_URL: 'http://api:8000',
    DISCORD_VOICE_WORKER_SECRET: 'test-secret',
  });
  const { room, replies } = setup({ providers });
  assert.equal(await room.askText(readQuestion(interaction('99', 'Qual é meu jogo favorito?'), callId)), 'complete');
  assert.equal(requests.length, 1);
  const [{ url, options }] = requests;
  assert.equal(url, 'http://api:8000/discord-voice/worker/turn');
  assert.equal(options.headers.authorization, 'Bearer test-secret');
  assert.deepEqual(JSON.parse(options.body), {
    guildId: '42', userId: '99', sessionId: callId, username: 'Mesmo apelido',
    transcript: 'Qual é meu jogo favorito?', inputMode: 'text',
  });
  assert.deepEqual(replies, [audio]);
});
