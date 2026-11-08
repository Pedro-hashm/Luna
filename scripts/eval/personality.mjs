import assert from 'node:assert/strict';
import { randomInt } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const api = process.env.LUNA_PERSONALITY_EVAL_URL;
const directory = process.env.LUNA_PERSONALITY_EVAL_OUTPUT;
const expectedModel = process.env.LUNA_PERSONALITY_EVAL_MODEL;
if (!api || !directory) throw new Error('Set LUNA_PERSONALITY_EVAL_URL to the disposable API and LUNA_PERSONALITY_EVAL_OUTPUT to a local report directory.');

const original = 'luna-current';
const sagaz = 'luna-sagaz';
const scenarios = [
  {
    id: 'ritmo-da-conversa',
    turns: [
      'Acertei de primeira. Confessa que ficou impressionada.',
      'Agora me diga só o número da porta padrão do PostgreSQL.',
      'Ok, já anotei. Obrigado.',
    ],
  },
  {
    id: 'opiniao',
    turns: ['Tô pensando em reescrever o módulo inteiro porque um teste falhou. O que você faria?'],
  },
  {
    id: 'frustracao',
    turns: ['Hoje nada encaixa. Passei a tarde nisso e já tô me sentindo burro.'],
  },
  {
    id: 'outra-deixa',
    turns: ['Dessa vez fiz o deploy sem esquecer a migration. Impressionante evolução, eu sei.'],
  },
];

async function json(path, init) {
  const response = await fetch(new URL(path, api), { signal: AbortSignal.timeout(90_000), ...init });
  if (!response.ok) throw new Error(path + ' HTTP ' + response.status);
  return response.json();
}

async function activate(id) {
  const response = await json('/personality/' + id + '/activate', { method: 'POST' });
  assert.equal(response.activeId, id);
}

async function ask(input, preset, previous) {
  const started = performance.now();
  const path = previous ? '/conversation/' + previous + '/messages' : '/conversation/messages';
  const reply = await json(path, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: input }),
  });
  const latencyMs = Math.round(performance.now() - started);
  const answer = reply.messages.find(item => item.role === 'assistant');
  assert.ok(answer?.content?.trim(), 'Assistant response is empty');
  if (expectedModel) assert.equal(answer.model, expectedModel);
  const inspector = await json('/observability/conversations/' + reply.conversationId);
  const trace = inspector.responses.find(item => item.responseMessageId === answer.id);
  assert.ok(trace, 'Missing response trace');
  assert.equal(trace.requestId, reply.requestId);
  assert.equal(trace.context.personality.id, preset);
  assert.equal(trace.context.personality.revision, 1);
  const promptHasPersonality = trace.context.promptMessages.some(item => item.content.startsWith('Luna personality (communication style):'));
  assert.equal(promptHasPersonality, preset === sagaz);
  if (input.includes('porta padrão')) assert.equal(answer.content.trim(), '5432');
  return {
    input, answer: answer.content, model: answer.model, latencyMs, conversationId: reply.conversationId,
    requestId: reply.requestId, trace,
  };
}

await mkdir(directory, { recursive: true });
const state = await json('/personality');
const results = { scenarios, runs: {}, status: 'incomplete' };
try {
  for (const preset of [original, sagaz]) {
    await activate(preset);
    results.runs[preset] = [];
    for (const scenario of scenarios) {
      const turns = [];
      results.runs[preset].push({ id: scenario.id, turns });
      for (const input of scenario.turns) {
        turns.push(await ask(input, preset, turns.at(-1)?.conversationId));
      }
    }
  }
  const earlier = results.runs[original][0].turns[0];
  results.switched = await ask('Qual é a porta padrão do PostgreSQL? Só o número.', sagaz, earlier.conversationId);
  assert.equal(results.switched.conversationId, earlier.conversationId);
  const inspector = await json('/observability/conversations/' + earlier.conversationId);
  assert.equal(inspector.responses.find(item => item.requestId === earlier.requestId && item.responseMessageId)
    .context.personality.id, original);
  const key = [];
  const pairs = results.runs[original].flatMap((scenario, index) =>
    scenario.turns.map((turn, turnIndex) => {
      const id = scenario.id + '/' + (turnIndex + 1);
      const sides = randomInt(2) ? [original, sagaz] : [sagaz, original];
      key.push({ id, a: sides[0], b: sides[1] });
      const answers = sides.map(side => results.runs[side][index].turns[turnIndex].answer);
      return { id, input: turn.input, a: answers[0], b: answers[1] };
    }),
  );
  await writeFile(join(directory, 'blind.json'), JSON.stringify(pairs, null, 2));
  results.blindKey = key;
  results.status = 'pass';
  console.log('Passed response, format, trace and existing conversation assertions. Review blind.json for style.');
} catch (error) {
  results.error = error.message;
  throw error;
} finally {
  await writeFile(join(directory, 'personality-report.json'), JSON.stringify(results, null, 2));
  await activate(state.activeId);
}
