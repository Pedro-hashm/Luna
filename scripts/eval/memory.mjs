import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const api = process.env.LUNA_MEMORY_EVAL_URL;
const project = process.env.LUNA_MEMORY_EVAL_PROJECT;
const out = process.env.LUNA_MEMORY_EVAL_OUTPUT;
if (!api || !out || !project || !/^luna-eval-[a-z0-9-]+$/.test(project)) {
  throw new Error('Use a disposable luna-eval project with LUNA_MEMORY_EVAL_URL, LUNA_MEMORY_EVAL_PROJECT and LUNA_MEMORY_EVAL_OUTPUT.');
}

const steps = [];
const report = { status: 'incomplete', steps };
const results = {};
async function request(path, method = 'GET', data) {
  const response = await fetch(new URL(path, api), {
    method, signal: AbortSignal.timeout(100_000),
    ...(data === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) }),
  });
  return { status: response.status, data: await response.json() };
}
async function json(path, method, data) {
  const response = await request(path, method, data);
  assert.ok(response.status < 300, path + ' HTTP ' + response.status + ' ' + JSON.stringify(response.data));
  return response.data;
}
async function step(name, fn) {
  try {
    await fn();
    steps.push({ name, pass: true });
    console.log('PASS ' + name);
  } catch (error) {
    steps.push({ name, pass: false, error: error.message });
    throw error;
  }
}
async function chat(content) {
  const reply = await json('/conversation/messages', 'POST', { content });
  const answer = reply.messages.find(message => message.role === 'assistant');
  const inspector = await json('/observability/conversations/' + reply.conversationId);
  const traces = inspector.responses.filter(trace => trace.requestId === reply.requestId);
  const trace = traces.find(item => item.responseMessageId === answer.id);
  assert.ok(trace);
  return { answer: answer.content, model: answer.model, traces, trace, user: reply.messages.find(message => message.role === 'user').id };
}

await mkdir(out, { recursive: true });
try {
  await step('explicit save uses the ordinary turn and is available in another chat', async () => {
    const initial = await json('/memory');
    assert.equal(initial.settings.suggestionsEnabled, false);
    assert.equal(initial.settings.allowExplicitUse, false);
    await json('/memory/settings', 'PATCH', { allowExplicitUse: true });
    results.remember = await chat('Lembre que meu editor padrão é Boreal Desk.');
    assert.ok(results.remember.traces.some(trace => trace.toolName === 'memory_save' && trace.status === 'success'));
    const dashboard = await json('/memory');
    const saved = dashboard.items.find(item => item.revisions[0].value.includes('Boreal Desk'));
    assert.equal(saved?.allowModel, true);
    const persisted = await json('/memory/items/' + saved.id);
    assert.equal(persisted.revisions[0].sources[0].messageId, results.remember.user);
    assert.equal(dashboard.queue.pending, 0);

    results.recall = await chat('Qual é meu editor padrão? Responda apenas o nome.');
    assert.match(results.recall.answer, /^Boreal Desk[.!]?\s*$/i);
    assert.ok(results.recall.traces.some(trace => trace.toolName === 'memory_search' && trace.status === 'success'));
    assert.ok(results.recall.trace.context.memory.items.some(item => item.id === saved.id));
    assert.doesNotMatch(JSON.stringify(results.recall.trace.context), /Boreal Desk/);
    assert.equal((await request('/tools/execute', 'POST', { tool: 'memory_search', input: { query: 'editor' } })).status, 400);
  });

  await step('private memory stays out of chat and unrelated requests skip recall', async () => {
    const saved = await json('/memory/items', 'POST', {
      subject: 'Usuário', predicate: 'apelido privado', scope: 'global', kind: 'profile',
      value: 'Privado Rutilo 88', allowModel: false, pinned: true,
    });
    results.private = await chat('Qual é meu apelido privado?');
    assert.doesNotMatch(results.private.answer, /Rutilo 88/i);
    assert.ok(!results.private.trace.context.memory.items.some(item => item.id === saved.id));
    assert.doesNotMatch(JSON.stringify(results.private.trace.context), /Rutilo 88/);
    results.unrelated = await chat('Qual é a porta padrão do PostgreSQL? Só o número.');
    assert.equal(results.unrelated.answer.trim(), '5432');
    assert.ok(!results.unrelated.traces.some(trace => trace.toolName === 'memory_search'));
    results.forget = await chat('Esqueça meu editor padrão.');
    assert.ok(results.forget.traces.some(trace => trace.toolName === 'memory_forget' && trace.status === 'success'));
    assert.ok(!(await json('/memory')).items.some(item => item.revisions[0].value.includes('Boreal Desk')));
  });

  await step('change and correction have distinct histories and reject stale edits', async () => {
    const draft = { subject: 'Usuário', predicate: 'residência', scope: 'global', kind: 'profile', allowModel: true };
    const old = await json('/memory/items', 'POST', { ...draft, value: 'Recife', validFrom: '2024-01-01' });
    const changed = await json('/memory/items/' + old.id, 'PATCH', {
      ...draft, version: old.version, value: 'Curitiba', validFrom: '2025-05-01', operation: 'change',
    });
    const past = await json('/memory/map?subject=Usu%C3%A1rio&date=2025-03-10');
    assert.equal(past.find(item => item.id === old.id).revisions[0].value, 'Recife');
    const present = await json('/memory/map?subject=Usu%C3%A1rio&date=2025-06-01');
    assert.equal(present.find(item => item.id === old.id).revisions[0].value, 'Curitiba');
    assert.equal((await request('/memory/items/' + old.id, 'PATCH', {
      ...draft, version: old.version, value: 'Natal', validFrom: '2025-05-01', operation: 'correct',
    })).status, 409);
    const corrected = await json('/memory/items/' + old.id, 'PATCH', {
      ...draft, version: changed.version, value: 'Londrina', validFrom: '2025-05-01', operation: 'correct',
    });
    const timeline = await json('/memory/items/' + old.id);
    assert.deepEqual(timeline.revisions.map(revision => revision.status), ['active', 'retracted', 'historical']);
    assert.equal(timeline.revisions[1].value, 'Curitiba');
    const map = await json('/memory/map?subject=Usu%C3%A1rio&date=2025-06-01');
    assert.equal(map.find(item => item.id === old.id).revisions[0].value, 'Londrina');
    assert.equal(corrected.version, 3);
    results.timeline = timeline;
  });

  await step('local batch proposes grounded facts and forgetting blocks replay', async () => {
    await json('/memory/settings', 'PATCH', { suggestionsEnabled: true });
    const hobby = await chat('Eu coleciono xícaras azuis como passatempo.');
    const ephemeral = await chat('Guarde só neste contexto de teste: a cor do meu editor é púrpura limão.');
    assert.ok(!ephemeral.traces.some(trace => trace.toolName === 'memory_save'));
    const queued = await json('/memory');
    assert.ok(queued.queue.pending >= 2);
    assert.ok(!queued.items.some(item => /xícaras azuis/i.test(item.revisions[0].value)));
    assert.ok(!queued.items.some(item => /púrpura limão/i.test(item.revisions[0].value)));
    const batch = await json('/memory/review', 'POST');
    const proposals = await json('/memory');
    assert.ok(!proposals.suggestions.some(item => item.messageId === ephemeral.user));
    const proposal = proposals.suggestions.find(item => item.messageId === hobby.user && /xícaras azuis/i.test(item.draft.value));
    assert.ok(proposal, 'The local extractor did not propose the declared hobby: ' + JSON.stringify(proposals.suggestions));
    assert.ok('Eu coleciono xícaras azuis como passatempo.'.includes(proposal.quote));
    const confirmed = await json('/memory/suggestions/' + proposal.id + '/approve', 'POST', { allowModel: true });
    const item = await json('/memory/items/' + confirmed.id);
    assert.equal(item.revisions[0].sources[0].messageId, hobby.user);
    await json('/memory/items/' + item.id + '?version=' + item.version, 'DELETE');
    assert.equal((await request('/memory/items/' + item.id)).status, 404);

    assert.match(hobby.user, /^[0-9a-f-]{36}$/);
    execFileSync('docker', ['exec', project + '-postgres-1', 'psql', '-X', '-U', 'eval', '-d', 'eval', '-v', 'ON_ERROR_STOP=1', '-c',
      'UPDATE memory_jobs SET done=false, attempts=0 WHERE "messageId" = ' + "'" + hobby.user + "'"], { stdio: 'pipe' });
    await json('/memory/review', 'POST');
    const replay = await json('/memory');
    assert.ok(!replay.suggestions.some(item => item.messageId === hobby.user));
    assert.ok(!replay.items.some(item => /xícaras azuis/i.test(item.revisions[0].value)));
    results.batch = { batch, afterReplay: replay.queue };
    await json('/memory/settings', 'PATCH', { suggestionsEnabled: false });
  });
  report.status = 'pass';
} finally {
  await writeFile(join(out, 'memory-report.json'), JSON.stringify({ ...report, results }, null, 2));
}
