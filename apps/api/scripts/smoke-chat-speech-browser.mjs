import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright';

const url = process.env.WEB_URL;
if (!url) throw new Error('Set WEB_URL to the isolated web stack.');

function wav() {
  const sampleRate = 16_000;
  const bytes = sampleRate * 2 * 6;
  const audio = Buffer.alloc(44 + bytes);
  audio.write('RIFF', 0);
  audio.writeUInt32LE(36 + bytes, 4);
  audio.write('WAVEfmt ', 8);
  audio.writeUInt32LE(16, 16);
  audio.writeUInt16LE(1, 20);
  audio.writeUInt16LE(1, 22);
  audio.writeUInt32LE(sampleRate, 24);
  audio.writeUInt32LE(sampleRate * 2, 28);
  audio.writeUInt16LE(2, 32);
  audio.writeUInt16LE(16, 34);
  audio.write('data', 36);
  audio.writeUInt32LE(bytes, 40);
  return audio;
}

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ baseURL: url, viewport: { width: 1280, height: 850 } });
  page.setDefaultTimeout(45_000);
  await page.addInitScript(() => {
    window.speechPlayback = { starts: 0, stops: 0, blockNext: false };
    const { play, pause } = HTMLMediaElement.prototype;
    HTMLMediaElement.prototype.play = async function () {
      if (window.speechPlayback.blockNext) {
        window.speechPlayback.blockNext = false;
        throw new DOMException('Synthetic browser autoplay block', 'NotAllowedError');
      }
      await play.call(this);
      window.speechPlayback.starts += 1;
    };
    HTMLMediaElement.prototype.pause = function () {
      if (!this.paused) window.speechPlayback.stops += 1;
      return pause.call(this);
    };
  });
  const speechRequests = [];
  const speechPath = response => new URL(response.url()).pathname.endsWith('/speech');
  page.on('request', request => { if (speechPath(request)) speechRequests.push(request.url()); });
  const auto = page.getByRole('button', { name: 'Ler respostas automaticamente' });
  const send = async (content) => {
    await page.getByRole('textbox', { name: 'Mensagem para Luna' }).fill(content);
    await page.getByRole('button', { name: 'Enviar mensagem' }).click();
  };
  const userText = 'Responda exatamente com o texto Jatobá 17.';
  await page.goto('/');
  assert.equal(await auto.getAttribute('aria-pressed'), 'false');
  await auto.click();

  const start = Date.now();
  const firstAudio = page.waitForResponse(speechPath, { timeout: 90_000 });
  await send(userText);
  await page.waitForURL('**/chat/*');
  const first = await firstAudio;
  assert.equal(first.status(), 200, await first.text().catch(() => ''));
  assert.match(first.headers()['content-type'], /^audio\//);
  assert.match(first.headers()['cache-control'], /no-store/);
  const firstBytes = (await first.body()).length;
  assert.ok(firstBytes > 1_000);
  const firstLatencyMs = Date.now() - start;
  await page.waitForFunction(() => window.speechPlayback.starts === 1);
  const id = new URL(page.url()).pathname.split('/').at(-1);
  const conversation = await (await page.request.get('/api/conversation/' + id)).json();
  const assistant = conversation.messages.find(message => message.role === 'assistant');
  const user = conversation.messages.find(message => message.role === 'user');
  assert.ok(new URL(first.url()).pathname.includes(assistant.id));
  assert.deepEqual(await (await page.request.get('/api/voice/sessions?conversationId=' + id)).json(), []);
  assert.equal((await page.request.post(`/api/voice/conversations/${randomUUID()}/messages/${assistant.id}/speech`)).status(), 404);

  await page.reload();
  await page.getByRole('article').filter({ hasText: userText }).waitFor();
  assert.equal(await auto.getAttribute('aria-pressed'), 'true');
  assert.equal(speechRequests.length, 1);
  assert.equal(await page.evaluate(() => window.speechPlayback.starts), 0);

  const message = page.getByRole('article').filter({ hasText: userText });
  const manualAudio = page.waitForResponse(speechPath, { timeout: 90_000 });
  await message.getByRole('button', { name: 'Ouvir mensagem' }).click();
  const manual = await manualAudio;
  assert.ok(new URL(manual.url()).pathname.includes(user.id));
  assert.equal(manual.status(), 200, await manual.text().catch(() => ''));
  await page.waitForFunction(() => window.speechPlayback.starts === 1);
  await message.getByRole('button', { name: 'Parar leitura' }).click();

  // A longer deterministic clip keeps cancellation and blocked autoplay independent of provider timing.
  await page.route('**/speech?offset=*', route => route.fulfill({ contentType: 'audio/wav', body: wav() }));
  await page.evaluate(() => { window.speechPlayback.blockNext = true; });
  await send('Responda somente Jatobá 17, por favor.');
  const blocked = page.getByRole('status').filter({ hasText: 'Clique em Ouvir para liberar o áudio' });
  await blocked.waitFor();
  const blockedMessage = page.getByRole('article').filter({ has: blocked });
  const requestsBeforeRetry = speechRequests.length;
  await blockedMessage.getByRole('button', { name: 'Ouvir mensagem' }).click();
  await page.waitForFunction(() => window.speechPlayback.starts === 2);
  assert.equal(speechRequests.length, requestsBeforeRetry);

  const stops = await page.evaluate(() => window.speechPlayback.stops);
  await page.getByRole('button', { name: 'Nova conversa', exact: true }).click();
  await page.waitForURL(url + '/');
  await page.waitForFunction(count => window.speechPlayback.stops > count, stops);
  assert.equal(await auto.getAttribute('aria-pressed'), 'false');
  const requestsBeforeOff = speechRequests.length;
  await send('Responda Jatobá 17 na nova conversa.');
  await page.waitForURL('**/chat/*');
  await page.getByRole('article').filter({ hasText: /^Jatobá 17$/ }).waitFor();
  assert.equal(speechRequests.length, requestsBeforeOff);
  console.log(JSON.stringify({ passed: true, firstBytes, firstLatencyMs, contentType: first.headers()['content-type'] }));
} finally {
  await browser.close();
}
