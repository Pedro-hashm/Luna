/** Browser Wake smoke with a held-out Kokoro sample as a deterministic microphone. */
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const data = join(root, 'tools', 'wakeword-training', 'data');
const web = process.env.WEB_URL ?? 'http://localhost:3000';
const api = process.env.API_URL ?? 'http://localhost:8000';
const kokoro = process.env.KOKORO_URL ?? 'http://localhost:8002';
const question = process.env.VOICE_BROWSER_QUESTION ?? 'Qual é a capital da Austrália?';
const expectResearch = process.env.VOICE_BROWSER_EXPECT_RESEARCH === '1';
const continuousWakeQuestion = process.env.VOICE_BROWSER_CONTINUOUS === '1';

function ffmpegPcm(wav) {
  const result = spawnSync('ffmpeg', ['-v', 'error', '-i', 'pipe:0', '-f', 's16le', '-ac', '1', '-ar', '16000', 'pipe:1'], {
    input: wav, maxBuffer: 10_000_000,
  });
  if (result.status !== 0 || !result.stdout.length) throw new Error(`ffmpeg: ${result.stderr?.toString()}`);
  return result.stdout;
}

function wave(pcm) {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(pcm.length + 36, 4);
  header.write('WAVEfmt ', 8); header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(16000, 24); header.writeUInt32LE(32000, 28);
  header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write('data', 36); header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

async function questionPcm(text = question) {
  const response = await fetch(`${kokoro}/v1/audio/speech`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'kokoro', input: text, voice: 'pf_dora', response_format: 'wav' }),
  });
  if (!response.ok) throw new Error(`Kokoro HTTP ${response.status}`);
  return ffmpegPcm(Buffer.from(await response.arrayBuffer()));
}

async function main() {
  const rows = (await readFile(join(data, 'manifest.jsonl'), 'utf8')).trim().split(/\r?\n/u).map(JSON.parse);
  const sample = rows.find((row) => row.label === 'positive' && row.split === 'test');
  if (!sample) throw new Error('Run wakeword prepare_data.py to create a held-out Luna sample');
  const wakePcm = ffmpegPcm(await readFile(join(root, 'tools', 'wakeword-training', sample.source_path)));
  const silence = (seconds) => Buffer.alloc(Math.round(seconds * 32000));
  const utterance = continuousWakeQuestion
    ? await questionPcm(`Luna, ${question}`)
    : Buffer.concat([wakePcm, silence(0.7), await questionPcm()]);
  const input = wave(Buffer.concat([silence(1.5), utterance, silence(300)]));
  const temporary = await mkdtemp(join(tmpdir(), 'luna-voice-browser-'));
  const inputPath = join(temporary, 'mic.wav');
  await writeFile(inputPath, input);
  const browser = await chromium.launch({
    channel: 'msedge', headless: true,
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
      '--autoplay-policy=no-user-gesture-required', `--use-file-for-fake-audio-capture=${inputPath}`],
  });
  try {
    const context = await browser.newContext({ permissions: ['microphone'] });
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.goto(`${web}/voice`);
    await page.waitForURL(/\/voice\/[0-9a-f-]{36}$/u);
    const conversationId = page.url().split('/').at(-1);
    await page.getByRole('button', { name: 'Ativar microfone' }).click();
    await page.getByText(/Sessão conectada/u).waitFor({ timeout: 20_000 });
    await page.getByText(/Você:/u).waitFor({ timeout: 120_000 });
    await page.getByText(/Luna:/u).waitFor({ timeout: 300_000 });
    const footer = await page.locator('footer').innerText();
    const sessionId = footer.match(/VoiceSession ([0-9a-f-]{36})/u)?.[1];
    if (!sessionId) throw new Error(`VoiceSession missing from browser: ${footer}`);
    let playbackCompleted = false;
    for (let attempt = 0; attempt < 240; attempt += 1) {
      const response = await context.request.get(`${api}/voice/sessions/${sessionId}/events`);
      const { session, events } = await response.json();
      if (events.some((event) => event.type === 'voice.tts.completed') && session.state === 'idle') {
        playbackCompleted = true;
        break;
      }
      await delay(1000);
    }
    if (!playbackCompleted) throw new Error('TTS was not played back to the browser and returned to Wake/Idle');
    await page.getByRole('button', { name: 'Desligar microfone' }).click();
    const detailResponse = await context.request.get(`${api}/conversation/${conversationId}`);
    const detail = await detailResponse.json();
    const voiceMessages = detail.messages.filter((item) => item.inputMode === 'voice' || item.outputMode === 'voice');
    if (voiceMessages.length !== 2) throw new Error(`Expected 2 persisted voice messages, got ${voiceMessages.length}; ${footer}`);
    let researchRuns = [];
    if (expectResearch) {
      const runsResponse = await context.request.get(`${api}/research/conversations/${conversationId}/runs`);
      const research = await runsResponse.json();
      researchRuns = research.runs ?? research;
      if (!researchRuns.some((run) => run.status === 'completed')) {
        throw new Error(`Voice Wake request did not complete ResearchRun: ${JSON.stringify(researchRuns)}`);
      }
    }
    if (pageErrors.length) throw new Error(`Browser errors: ${pageErrors.join('; ')}`);
    console.log(JSON.stringify({ passed: true, conversationId, sessionId, wakeSample: sample.source_path,
      question, continuousWakeQuestion, user: voiceMessages[0].content, response: voiceMessages[1].content,
      researchRunIds: researchRuns.map((run) => run.id ?? run.researchRunId), pageErrors }, null, 2));
    await context.close();
  } finally {
    await browser.close();
    await rm(temporary, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
