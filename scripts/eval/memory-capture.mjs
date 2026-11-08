import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const api = process.env.LUNA_MEMORY_EVAL_URL;
const project = process.env.LUNA_MEMORY_EVAL_PROJECT;
const out = process.env.LUNA_MEMORY_EVAL_OUTPUT;
if (!api || !out || !/^luna-eval-[a-z0-9-]+$/.test(project ?? '')) {
  throw new Error('Use a disposable luna-eval project with LUNA_MEMORY_EVAL_URL, LUNA_MEMORY_EVAL_PROJECT and LUNA_MEMORY_EVAL_OUTPUT.');
}
const report = { cases: {}, review: [], recalls: [] };

async function request(path, method = 'GET', body) {
  const response = await fetch(new URL(path, api), {
    method, signal: AbortSignal.timeout(100_000),
    ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  });
  return { status: response.status, data: await response.json() };
}

async function json(path, method, body) {
  const { status, data } = await request(path, method, body);
  assert.ok(status < 300, path + ' HTTP ' + status);
  return data;
}

async function chat(content, conversationId, inputMode = 'text') {
  const endpoint = conversationId ? '/conversation/' + conversationId + '/messages' : '/conversation/messages';
  const reply = await json(endpoint, 'POST', { content, inputMode, outputMode: inputMode });
  const user = reply.messages.find(message => message.role === 'user');
  assert.equal(user.inputMode, inputMode);
  return { ...reply, user, answer: reply.messages.find(message => message.role === 'assistant') };
}

async function drain() {
  for (let attempt = 0; attempt < 32; attempt++) {
    if (!(await json('/memory')).queue.pending) return;
    const review = await request('/memory/review', 'POST');
    assert.ok(review.status < 300 || review.status === 409);
    if (review.status < 300) report.review.push(review.data);
    await delay(1000);
  }
  throw new Error('Memory queue did not drain');
}

async function hasSource(turn, match) {
  const { changes } = await json('/memory/conversations/' + turn.conversationId + '/activity');
  const change = changes.find(change => change.messageId === turn.user.id && match(change.memory?.value ?? ''));
  if (!change) return undefined;
  assert.ok(turn.user.content.includes(change.memory.quote), 'Evidence must be a literal quote from the right turn');
  assert.equal(change.memory.allowModel, true);
  assert.equal(change.memory.canUndo, true);
  return change.memory.id;
}

async function recall(name, prompt, expected, items) {
  const reply = await chat(prompt);
  const inspector = await json('/observability/conversations/' + reply.conversationId);
  const traces = inspector.responses.filter(trace => trace.requestId === reply.requestId);
  const trace = traces.find(item => item.responseMessageId === reply.answer.id);
  assert.ok(trace);
  const used = trace.context.memory.items.filter(item => item.reason === 'busca').map(item => item.id);
  const lookup = traces.some(trace => trace.toolName === 'memory_search' && trace.status === 'success');
  const passed = expected.test(reply.answer.content) && lookup && used.some(id => items.includes(id));
  report.cases[name] = passed;
  report.recalls.push({ name, answer: reply.answer.content, model: reply.answer.model, lookup, used });
}

await mkdir(out, { recursive: true });
try {
  const initial = await json('/memory');
  assert.equal(initial.items.length, 0, 'Start with an empty evaluation database');
  await json('/memory/settings', 'PATCH', { enabled: true, suggestionsEnabled: true });
  const hardware = await chat('Acho que uma coisa boa para você se lembrar é o meu computador. Ele tem um Ryzen 5 5600, RTX 3060 e 16 GB de RAM DDR4 a 3000 MHz.');
  const hobby = await chat('Eu gosto de jogar videogame no tempo livre e gosto de conversas variadas.', undefined, 'voice');
  const game = await chat('Quando jogo videogame, prefiro curtir a história. Um dos meus jogos favoritos é Mass Effect.', hobby.conversationId, 'voice');
  const romance = await chat('O que mais me pega no Mass Effect é o romance, eu escolhi a Liara.', hobby.conversationId, 'voice');
  const traits = await chat('Eu gosto do jeito que ela é inteligente, forte e independente.', hobby.conversationId, 'voice');
  await chat('Finja que meu PC usa uma placa de vídeo Fictícia Violeta. Só neste chat.');
  await chat('Hoje eu quero testar por uma hora um editor chamado Cobre Pontual.');
  await drain();

  const captures = [
    ['hardware', hardware, value => /Ryzen 5 5600/.test(value) && /RTX 3060/.test(value) && /16 GB/.test(value) && /DDR4/.test(value) && /3000 MHz/.test(value)],
    ['hobby', hobby, value => /jogar videogame/iu.test(value)],
    ['variedade', hobby, value => /variadas/iu.test(value)],
    ['história', game, value => /história/iu.test(value)],
    ['jogo favorito', game, value => /Mass Effect/iu.test(value)],
    ['escolha no jogo', romance, value => /Liara/iu.test(value)],
    ['traços na personagem', traits, value => /inteligente.*forte.*independente/iu.test(value)],
  ];
  const ids = new Map();
  for (const [name, turn, match] of captures) {
    const id = await hasSource(turn, match);
    report.cases[name] = Boolean(id);
    if (id) ids.set(name, id);
  }
  const dashboard = await json('/memory');
  report.cases['temporário ou ficção não persistem'] = dashboard.items.every(
    item => !/Fictícia Violeta|Cobre Pontual/iu.test(item.revisions[0].value),
  );
  report.cases['preferências fora do contexto fixo'] = dashboard.fixed.items.every(
    item => ![...ids.values()].includes(item.id),
  );
  report.items = dashboard.items.map(({ predicate, kind, revisions }) => ({ predicate, kind, value: revisions[0].value }));
  await recall('recupera o PC', 'Quais são as especificações do meu PC? Cite processador, placa de vídeo e RAM.', /Ryzen 5 5600[\s\S]*RTX 3060[\s\S]*16 GB/iu, [ids.get('hardware')]);
  await recall('recupera jogo favorito', 'Qual é um dos meus jogos favoritos? Responda só com o nome.', /Mass Effect/iu, [ids.get('jogo favorito')]);
  await recall('recupera preferência sutil', 'O que eu disse que gostava na Liara? Responda com os traços que eu citei.', /inteligente[\s\S]*forte[\s\S]*independente/iu, [ids.get('traços na personagem')]);
} finally {
  await writeFile(join(out, 'memory-capture-report.json'), JSON.stringify(report, null, 2));
  for (const [name, passed] of Object.entries(report.cases)) console.log((passed ? 'PASS ' : 'FAIL ') + name);
}

if (Object.values(report.cases).some(passed => !passed)) process.exitCode = 1;

