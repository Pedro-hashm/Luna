import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const { LUNA_MEMORY_EVAL_URL: api, LUNA_MEMORY_EVAL_PROJECT: project, LUNA_MEMORY_EVAL_OUTPUT: out } = process.env;
if (!api || !out || !/^luna-eval-[a-z0-9-]+$/.test(project ?? '')) {
  throw new Error('Use an isolated luna-eval stack.');
}

async function request(path, method = 'GET', data) {
  const response = await fetch(new URL(path, api), {
    method, signal: AbortSignal.timeout(100_000),
    ...(data === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) }),
  });
  assert.ok(response.ok, path + ' returned ' + response.status);
  return response.json();
}

const report = { passed: false };
try {
  await request('/memory/settings', 'PATCH', { suggestionsEnabled: true, allowExplicitUse: true });
  const forgotten = await request('/memory/items', 'POST', {
    subject: 'Usuário', predicate: 'nome', kind: 'profile', value: 'Caio', allowModel: true,
  });
  await request('/memory/items/' + forgotten.id + '?version=' + forgotten.version, 'DELETE');
  const introduction = await request('/conversation/messages', 'POST', {
    content: 'meu nome é caio, o nome completo é caio nunes da costa, prazer',
  });
  const source = introduction.messages.find(message => message.role === 'user');
  assert.ok(source?.id);
  const pending = await request('/memory');
  const activity = await request('/memory/conversations/' + introduction.conversationId + '/activity');
  const matches = activity.changes.filter(item => item.messageId === source.id);
  assert.equal(matches.length, 1);
  const [change] = matches;
  assert.equal(change.status, 'saved');
  assert.equal(change.memory.predicate, 'nome completo');
  assert.equal(change.memory.value, 'caio nunes da costa');
  assert.equal(change.memory.allowModel, true);
  assert.ok(source.content.includes(change.memory.quote));
  assert.equal(pending.items.length, 1);
  assert.equal(pending.suggestions.length, 0);
  report.literalAutosave = true;

  const question = await request('/conversation/' + introduction.conversationId + '/messages', 'POST', {
    content: 'tu não devia se lembrar disso não?',
  });
  const answer = question.messages.find(message => message.role === 'assistant');
  const inspector = await request('/observability/conversations/' + introduction.conversationId);
  const final = inspector.responses.find(trace => trace.responseMessageId === answer.id);
  assert.ok(final?.context.promptMessages.some(message => message.role === 'system' && message.content.includes('Uma memória da mensagem anterior foi salva')));
  report.followup = { model: answer.model, text: answer.content, latencyMs: final.latencyMs, inputTokens: final.inputTokens };
  assert.match(answer.content, /salvei.*memória/i);
  assert.match(answer.content, /desfazer/i);

  const recall = await request('/conversation/messages', 'POST', { content: 'Qual é meu nome completo? Responda só o nome.' });
  const recalled = recall.messages.find(message => message.role === 'assistant');
  const recalledTrace = (await request('/observability/conversations/' + recall.conversationId))
    .responses.find(trace => trace.responseMessageId === recalled.id);
  report.recall = { model: recalled.model, text: recalled.content };
  assert.match(recalled.content, /^caio nunes da costa[.!]?\s*$/i);
  assert.ok(recalledTrace?.context.memory.items.some(item => item.id === change.memory.id && item.reason === 'busca'));
  await request('/memory/changes/' + change.id + '/undo', 'POST');
  assert.equal((await request('/memory')).items.length, 0);
  report.passed = true;
} finally {
  await mkdir(out, { recursive: true });
  await writeFile(join(out, 'memory-awareness-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: report.passed, literalAutosave: report.literalAutosave }));
}
