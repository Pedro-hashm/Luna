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
  assert.equal((await request('/memory')).items.length, 0);
  await request('/memory/review', 'POST');
  const pending = await request('/memory');
  const matches = pending.suggestions.filter(item => item.messageId === source.id);
  assert.equal(matches.length, 1);
  const [suggestion] = matches;
  assert.equal(suggestion.draft.predicate, 'nome completo');
  assert.equal(suggestion.draft.value, 'caio nunes da costa');
  assert.ok(source.content.includes(suggestion.quote));
  assert.equal(pending.items.length, 0);
  report.literalReview = true;

  const question = await request('/conversation/' + introduction.conversationId + '/messages', 'POST', {
    content: 'tu não devia se lembrar disso não?',
  });
  const answer = question.messages.find(message => message.role === 'assistant');
  const inspector = await request('/observability/conversations/' + introduction.conversationId);
  const final = inspector.responses.find(trace => trace.responseMessageId === answer.id);
  assert.ok(final?.context.promptMessages.some(message => message.role === 'system' && message.content.includes('aguardando aprovação')));
  report.followup = { model: answer.model, text: answer.content, latencyMs: final.latencyMs, inputTokens: final.inputTokens };
  assert.match(answer.content, /sugest|aprova|revis/i);
  assert.match(answer.content, /outros? chats?|outras conversas|conversas futuras|entre conversas/i);
  assert.doesNotMatch(answer.content, /\b(?:já|ja)\s+(?:salvei|gravei)\b/iu);

  const saved = await request('/memory/suggestions/' + suggestion.id + '/approve', 'POST', { allowModel: true });
  const recall = await request('/conversation/messages', 'POST', { content: 'Qual é meu nome completo? Responda só o nome.' });
  const recalled = recall.messages.find(message => message.role === 'assistant');
  const recalledTrace = (await request('/observability/conversations/' + recall.conversationId))
    .responses.find(trace => trace.responseMessageId === recalled.id);
  report.recall = { model: recalled.model, text: recalled.content };
  assert.match(recalled.content, /^caio nunes da costa[.!]?\s*$/i);
  assert.ok(recalledTrace?.context.memory.items.some(item => item.id === saved.id && item.reason === 'busca'));
  report.passed = true;
} finally {
  await mkdir(out, { recursive: true });
  await writeFile(join(out, 'memory-awareness-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: report.passed, literalReview: report.literalReview }));
}
