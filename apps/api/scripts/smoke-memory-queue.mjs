import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const project = process.env.LUNA_MEMORY_EVAL_PROJECT;
const api = new URL(process.env.LUNA_MEMORY_EVAL_URL);
const web = new URL(process.env.WEB_URL);
if (!/^luna-eval-[a-z0-9-]+$/.test(project ?? '') ||
    [api, web].some(url => url.hostname !== '127.0.0.1' || !url.port || ['3000', '8000'].includes(url.port))) {
  throw new Error('Use a disposable luna-eval project and its ephemeral loopback ports.');
}
const { chromium } = await import(process.env.LUNA_PLAYWRIGHT_URL ?? 'playwright');
const baseline = process.env.LUNA_QUEUE_EXPECT_BASELINE === '1';
const chat = '11111111-1111-4111-8111-111111111111';
const pending = '22222222-2222-4222-8222-222222222221';
const shortText = 'Fila sintética: preferência por editor Neblina <tag>.';
const longText = 'Fila sintética: texto longo. ';
const labels = { processing: 'Em análise', failed: 'Falhou', processed: 'Analisada' };

function sql(query) {
  return execFileSync('docker', ['exec', '-i', project + '-postgres-1', 'psql',
    '-XAt', '-U', 'eval', '-d', 'eval', '-v', 'ON_ERROR_STOP=1'], { input: query, encoding: 'utf8' }).trim();
}

assert.equal(sql('SELECT count(*) FROM messages;'), '0');
sql("INSERT INTO conversations (id,title,updated_at) VALUES ('" + chat + "','Conversa sintética da fila',now());\n" +
  "INSERT INTO messages (id,conversation_id,role,content,created_at,input_mode) VALUES\n" +
  "('" + pending + "','" + chat + "','user','" + shortText + "',now(),'voice'),\n" +
  "('22222222-2222-4222-8222-222222222222','" + chat + "','user','Fila sintética: terceira tentativa ativa.',now()-interval '1 second','text'),\n" +
  "('22222222-2222-4222-8222-222222222223','" + chat + "','user','" + longText + "'||repeat('a',400),now()-interval '2 seconds','text'),\n" +
  "('22222222-2222-4222-8222-222222222224','" + chat + "','user','Fila sintética: mensagem analisada.',now()-interval '3 seconds','text'),\n" +
  "('22222222-2222-4222-8222-222222222225','" + chat + "','assistant','Fila sintética: conteúdo da assistente.',now()-interval '4 seconds','text');\n" +
  'INSERT INTO memory_jobs ("messageId","availableAt","leaseUntil",attempts,done) VALUES\n' +
  "('" + pending + "',now(),null,0,false),\n" +
  "('22222222-2222-4222-8222-222222222222',now(),now()+interval '5 minutes',3,false),\n" +
  "('22222222-2222-4222-8222-222222222223',now(),now()-interval '5 minutes',3,false),\n" +
  "('22222222-2222-4222-8222-222222222224',now(),null,1,true),\n" +
  "('22222222-2222-4222-8222-222222222225',now(),null,0,false);");

const response = await fetch(new URL('/memory/queue', api));
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 430, height: 860 } });
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto(new URL('/settings/memory', web).href);
  await page.getByRole('button', { name: 'Atividade', exact: true }).click();
  if (baseline) {
    assert.equal(response.status, 404);
    await page.getByText(/mensagem\(ns\) na fila/u).waitFor();
    assert.equal(await page.getByText(shortText, { exact: true }).count(), 0);
    console.log('PASS baseline reproduces count without messages');
  } else {
    assert.equal(response.status, 200);
    assert.match(response.headers.get('cache-control') ?? '', /no-store/u);
    const initial = await response.json();
    assert.deepEqual([initial.pending, initial.failed, initial.pageCount], [2, 1, 1]);
    assert.deepEqual(initial.active.map(({ state }) => state).sort(), ['failed', 'pending', 'processing']);
    assert.equal(initial.recent[0]?.state, 'processed');
    assert.equal(initial.active.find(({ state }) => state === 'failed').preview.length, 281);
    assert.equal((await fetch(new URL('/memory/queue?page=0', api))).status, 400);

    const queue = page.getByRole('region', { name: 'Fila de análise', exact: true });
    const recent = page.getByRole('region', { name: 'Mensagens recentes já analisadas', exact: true });
    const row = queue.getByRole('listitem').filter({ hasText: shortText });
    await row.getByText('Voz', { exact: true }).waitFor();
    await row.getByText('Aguardando análise').waitFor();
    await queue.getByText('2 mensagens na fila · 1 falhou').waitFor();
    await queue.getByText(labels.processing, { exact: true }).waitFor();
    await queue.getByText(labels.failed, { exact: true }).waitFor();
    await recent.getByText(labels.processed, { exact: true }).waitFor();
    assert.equal(await page.getByText(/conteúdo da assistente/u).count(), 0);

    sql('UPDATE memory_jobs SET done=true WHERE "messageId"=\'' + pending + "';");
    const moved = recent.getByRole('listitem').filter({ hasText: shortText });
    await moved.getByText(labels.processed, { exact: true }).waitFor({ timeout: 12_000 });
    await queue.getByText(shortText, { exact: true }).waitFor({ state: 'detached' });
    assert.equal(await moved.getByRole('link', { name: 'Ver conversa' }).getAttribute('href'), '/chat/' + chat);

    sql("WITH inserted AS (INSERT INTO messages (id,conversation_id,role,content,input_mode) SELECT gen_random_uuid(),'" + chat +
      "','user','Fila extra '||n,'text' FROM generate_series(1,21) n RETURNING id) " +
      'INSERT INTO memory_jobs ("messageId","availableAt") SELECT id,now() FROM inserted;');
    await queue.getByRole('button', { name: 'Próxima' }).click({ timeout: 12_000 });
    await queue.getByText('Página 2 de 2').waitFor();
    assert.equal(await queue.getByRole('listitem').count(), 3);
    await moved.getByRole('link', { name: 'Ver conversa' }).click();
    await page.waitForURL('**/chat/' + chat);
    await page.getByText(shortText, { exact: true }).waitFor();

    sql('UPDATE memory_jobs SET done=true;');
    await page.goto(new URL('/settings/memory', web).href);
    await page.getByRole('button', { name: 'Atividade', exact: true }).click();
    await page.getByText('Nenhuma mensagem aguardando análise.').waitFor();
    assert.equal(await recent.getByRole('listitem').count(), 5);
    console.log('PASS queue statuses, previews, pagination, polling, conversation link and empty state');
  }
  assert.deepEqual(pageErrors, []);
} finally {
  await browser.close();
}

