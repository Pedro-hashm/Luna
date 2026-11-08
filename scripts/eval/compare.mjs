import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const { values } = parseArgs({
  options: {
    base: { type: 'string' },
    candidate: { type: 'string' },
    cases: { type: 'string', default: join(here, 'cases.json') },
    fixture: { type: 'boolean' },
    router: { type: 'string' },
    model: { type: 'string' },
    repetitions: { type: 'string', default: '1' },
    unit: { type: 'boolean' },
  },
});
const { base, candidate, fixture, model, router } = values;
if (!base || !candidate || (fixture ? model || router : !model || !router)) {
  throw new Error('Use --base REF --candidate REF and either --fixture or --router URL --model NAME');
}
if (router) {
  const url = new URL(router);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('Router must be an HTTP URL without credentials, query or fragment');
  }
}
const repetitions = Number(values.repetitions);
if (!Number.isInteger(repetitions) || repetitions < 1 || repetitions > 10) {
  throw new Error('Repetitions must be an integer from 1 to 10');
}
const cases = JSON.parse(readFileSync(values.cases, 'utf8'));
if (!Array.isArray(cases) || !cases.length || cases.some(test =>
  typeof test.id !== 'string' || !/^[a-z0-9-]+$/.test(test.id) ||
  !Array.isArray(test.turns) || !test.turns.length || test.turns.some(turn =>
    typeof turn.input !== 'string' || !turn.input.trim() ||
    ['contains', 'excludes', 'tools'].some(key =>
      turn[key] !== undefined && (!Array.isArray(turn[key]) ||
        turn[key].some(value => typeof value !== 'string' || !value.trim())),
    ),
  ),
) || new Set(cases.map(test => test.id)).size !== cases.length) {
  throw new Error('Invalid evaluation cases. See docs/feature-workflow.md');
}
const run = randomUUID().replaceAll('-', '').slice(0, 12);
const output = join(root, '.luna-eval', run);
mkdirSync(output, { recursive: true });
const report = { run, fixture: Boolean(fixture), model: model ?? 'fixture', repetitions };
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

function exec(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  });
}

function sha(ref) {
  return exec('git', ['rev-parse', '--verify', '--end-of-options', ref + '^{commit}']).trim();
}

function build(commit) {
  const image = 'luna-eval-api:' + commit;
  const tempRoot = resolve(tmpdir());
  const temp = mkdtempSync(join(tempRoot, 'luna-eval-'));
  try {
    const archive = join(temp, 'revision.tar');
    const source = join(temp, 'source');
    mkdirSync(source);
    exec('git', ['archive', '--format=tar', '--output=' + archive, commit]);
    exec('tar', ['-xf', archive, '-C', source]);
    exec('docker', ['build', '-f', 'apps/api/Dockerfile', '--target', 'migrate', '-t', image, '.'], {
      cwd: source, stdio: 'inherit',
    });
    return image;
  } finally {
    if (dirname(temp) === tempRoot) rmSync(temp, { recursive: true, force: true, maxRetries: 3 });
  }
}

async function json(url, body) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(180_000),
    ...(body && { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  });
  if (!response.ok) throw new Error(new URL(url).pathname + ' returned HTTP ' + response.status);
  return response.json();
}

function assertions(turn, answer, traces) {
  const actual = answer.normalize('NFC').toLocaleLowerCase('pt-BR');
  const contains = phrase => actual.includes(phrase.normalize('NFC').toLocaleLowerCase('pt-BR'));
  return [
    ...(turn.contains ?? []).filter(phrase => !contains(phrase)).map(phrase => 'missing: ' + phrase),
    ...(turn.excludes ?? []).filter(contains).map(phrase => 'unexpected: ' + phrase),
    ...(turn.tools ?? []).filter(tool => !traces.some(trace =>
      trace.kind === 'tool' && trace.status === 'success' && trace.toolName === tool,
    )).map(tool => 'missing successful tool: ' + tool),
  ];
}

async function executeCase(test, repeat, url, compose) {
  const result = { id: test.id, repeat, turns: [], status: 'pass' };
  let conversationId;
  try {
    for (const turn of test.turns) {
      const start = performance.now();
      const path = conversationId ? '/' + conversationId + '/messages' : '/messages';
      const reply = await json(url + '/conversation' + path, { content: turn.input });
      const latencyMs = Math.round(performance.now() - start);
      conversationId = reply.conversationId;
      const answer = reply.messages.find(message => message.role === 'assistant');
      if (!uuid.test(conversationId) || !answer || !uuid.test(answer.id) || !answer.content?.trim()) {
        throw new Error('Missing conversation or assistant response');
      }
      const inspector = await json(url + '/observability/conversations/' + conversationId);
      const final = inspector.responses.find(trace => trace.responseMessageId === answer.id);
      // The original API omitted requestId from both HTTP responses.
      const legacyRows = !final?.requestId ? new Map(JSON.parse(compose([
        'exec', '-T', 'postgres', 'psql', '-XAt', '-U', 'eval', '-d', 'eval', '-v', 'ON_ERROR_STOP=1', '-c',
        "SELECT COALESCE(json_agg(json_build_array(id, request_id)), '[]') FROM observability_traces WHERE conversation_id = '" + conversationId + "'",
      ]))) : null;
      const idOf = trace => trace?.requestId ?? legacyRows?.get(trace?.traceId);
      const requestId = idOf(final);
      if (!final || !uuid.test(requestId) || (reply.requestId && reply.requestId !== requestId)) {
        throw new Error('Response could not be correlated to its trace');
      }
      const traces = inspector.responses.filter(trace => idOf(trace) === requestId);
      const researchRuns = await json(url + '/research/conversations/' + conversationId + '/runs');
      const research = await Promise.all(researchRuns.filter(item => item.requestId === requestId)
        .map(item => json(url + '/research/runs/' + item.id)));
      const failures = assertions(turn, answer.content, traces);
      result.turns.push({
        input: turn.input, answer: answer.content, conversationId, requestId,
        messageId: answer.id, model: answer.model, latencyMs, failures, traces, research,
      });
      if (failures.length) result.status = 'fail';
    }
  } catch (error) {
    result.status = 'incomplete';
    result.error = error.message;
  }
  return result;
}

async function evaluate(label, image) {
  const env = {
    ...process.env,
    COMPOSE_DISABLE_ENV_FILE: '1',
    LUNA_EVAL_IMAGE: image,
    LUNA_EVAL_ROUTER: fixture ? 'http://fixture:8080/v1' : router,
    LUNA_EVAL_MODEL: fixture ? 'eval-luna' : model,
    LUNA_EVAL_ORCHESTRATOR: fixture ? 'eval-orchestrator' : model,
    LUNA_EVAL_OLLAMA: fixture ? '' : process.env.LUNA_EVAL_OLLAMA ?? 'http://host.docker.internal:11435',
    LUNA_EVAL_RERANKER: fixture ? '' : process.env.LUNA_EVAL_RERANKER ?? '',
    LUNA_EVAL_SEARCH: fixture ? '' : process.env.LUNA_EVAL_SEARCH ?? '',
  };
  const compose = (args, options) => exec('docker', [
    'compose', '-f', join(here, 'compose.yml'), '-p', 'luna-eval-' + run + '-' + label, ...args,
  ], { env, ...options });
  const results = [];
  try {
    if (fixture) {
      compose(['up', '-d', '--wait', '--wait-timeout', '60', 'fixture'], { stdio: 'inherit' });
    }
    compose(['up', '-d', '--wait', '--wait-timeout', '180', 'api'], { stdio: 'inherit' });
    const address = compose(['port', 'api', '8000']).trim();
    if (!/^127\.0\.0\.1:\d+$/.test(address)) throw new Error('Unexpected API binding');
    for (let repeat = 1; repeat <= repetitions; repeat++) {
      for (const test of cases) results.push(await executeCase(test, repeat, 'http://' + address, compose));
    }
  } finally {
    try {
      writeFileSync(join(output, label + '.log'), compose(['logs', '--no-color', '--timestamps']));
    } finally {
      compose(['down', '--volumes', '--remove-orphans'], { stdio: 'inherit' });
    }
  }
  return results;
}

try {
  report.base = { sha: sha(base) };
  report.candidate = { sha: sha(candidate) };
  const baseImage = build(report.base.sha);
  const candidateImage = report.candidate.sha === report.base.sha ? baseImage : build(report.candidate.sha);
  if (values.unit) {
    exec('docker', ['run', '--rm', '--network', 'none', candidateImage, 'pnpm', 'exec', 'jest', '--runInBand'], {
      stdio: 'inherit',
    });
  }
  report.base.cases = await evaluate('base', baseImage);
  report.candidate.cases = await evaluate('candidate', candidateImage);
  report.comparison = report.candidate.cases.map((test, index) => ({
    case: test.id, repetition: test.repeat, base: report.base.cases[index].status, candidate: test.status,
  }));
  console.table(report.comparison);
  report.status = report.comparison.some(item => [item.base, item.candidate].includes('incomplete'))
    ? 'incomplete'
    : report.comparison.every(item => item.candidate === 'pass') ? 'pass' : 'fail';
} catch (error) {
  report.status = 'incomplete';
  report.error = error.message;
  console.error('Evaluation incomplete. Inspect the local report and logs.');
} finally {
  writeFileSync(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(report.status + ' | ' + relative(root, join(output, 'report.json')));
  process.exitCode = report.status === 'pass' ? 0 : report.status === 'fail' ? 1 : 2;
}
