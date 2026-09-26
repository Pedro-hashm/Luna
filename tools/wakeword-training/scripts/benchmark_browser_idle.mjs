/** Exercise the actual Voice UI in Wake/Idle for 10, 30, or 60 wall minutes.
 *
 * Edge receives a recorded ambient WAV through Chromium's fake microphone. The
 * default is an audible one-minute recording from training, repeated to measure
 * the browser/API path and resource use. It is not independent evaluation data.
 */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';

const root = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const require = createRequire(join(root, 'apps/api/package.json'));
const { chromium } = require('playwright');
const exec = promisify(execFile);
const containers = ['api', 'web', 'wakeword', 'speaches', 'kokoro', 'ollama', 'searxng'].map((name) => `luna-v2-${name}`);
const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  if (!process.argv[index + 1]) throw new Error(`${name} requires a value`);
  return process.argv[index + 1];
}

function waveData(wav) {
  if (wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 12) !== 'WAVE') throw new Error('Expected RIFF WAV');
  let offset = 12;
  let format;
  let audio;
  while (offset + 8 <= wav.length) {
    const tag = wav.toString('ascii', offset, offset + 4);
    const length = wav.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (tag === 'fmt ') format = wav.subarray(start, start + length);
    if (tag === 'data') audio = wav.subarray(start, start + length);
    offset = start + length + (length % 2);
  }
  if (!format || !audio || format.readUInt16LE(0) !== 1 || format.readUInt16LE(2) !== 1 ||
      format.readUInt32LE(4) !== 16000 || format.readUInt16LE(14) !== 16) {
    throw new Error('Ambient WAV must be mono PCM16 at 16 kHz');
  }
  return audio;
}

function waveHeader(bytes) {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(bytes + 36, 4);
  header.write('WAVEfmt ', 8); header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(16000, 24); header.writeUInt32LE(32000, 28);
  header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write('data', 36); header.writeUInt32LE(bytes, 40);
  return header;
}

async function defaultAmbientFile() {
  const directory = join(root, 'tools/wakeword-training/data/background/train');
  const names = (await readdir(directory)).filter((name) => name.toLowerCase().endsWith('.wav') && !name.toLowerCase().includes('synthetic'));
  const candidates = [];
  for (const name of names) {
    const path = join(directory, name);
    try {
      const pcm = waveData(await readFile(path));
      if (pcm.length < 30 * 32000) continue;
      let power = 0;
      let n = 0;
      for (let offset = 0; offset + 1 < pcm.length; offset += 64) {
        const value = pcm.readInt16LE(offset) / 32768;
        power += value * value;
        n += 1;
      }
      const rms = Math.sqrt(power / n);
      if (rms > 0.003) candidates.push({ path, rms });
    } catch { /* Skip unsupported training WAV. */ }
  }
  candidates.sort((a, b) => b.rms - a.rms);
  if (!candidates.length) throw new Error('No audible >=30-second PCM16 training background; pass --ambient-file');
  return candidates[0].path;
}

async function recordedMicrophone(sourcePath, seconds, target) {
  const original = await readFile(sourcePath);
  const pcm = waveData(original);
  let power = 0;
  let peak = 0;
  let n = 0;
  for (let offset = 0; offset + 1 < pcm.length; offset += 2) {
    const value = pcm.readInt16LE(offset) / 32768;
    power += value * value;
    peak = Math.max(peak, Math.abs(value));
    n += 1;
  }
  const needed = Math.ceil(seconds * 32000 / pcm.length);
  const total = needed * pcm.length;
  const output = Buffer.allocUnsafe(44 + total);
  waveHeader(total).copy(output, 0);
  for (let i = 0; i < needed; i += 1) pcm.copy(output, 44 + i * pcm.length);
  await writeFile(target, output);
  return { source: sourcePath, sourceSha256: createHash('sha256').update(original).digest('hex'),
    originalSeconds: pcm.length / 32000, rms: Math.sqrt(power / n), peak,
    usedInTraining: sourcePath.includes(`${join('background', 'train')}`),
    repeated: needed, fakeMicrophoneSeconds: total / 32000 };
}

async function measureSystemMicrophone(page) {
  return page.evaluate(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: {
      channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false,
    } });
    const context = new AudioContext();
    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    analyser.fftSize = 2048;
    const silent = context.createGain();
    silent.gain.value = 0;
    source.connect(analyser).connect(silent).connect(context.destination);
    const samples = new Float32Array(analyser.fftSize);
    const levels = [];
    for (let i = 0; i < 30; i += 1) {
      analyser.getFloatTimeDomainData(samples);
      let power = 0;
      for (const value of samples) power += value * value;
      levels.push(Math.sqrt(power / samples.length));
      await new Promise((done) => setTimeout(done, 100));
    }
    stream.getTracks().forEach((track) => track.stop());
    await context.close();
    levels.sort((a, b) => a - b);
    return { deviceLabel: stream.getAudioTracks()[0]?.label ?? '',
      rmsMedian: levels[Math.floor(levels.length / 2)], rmsP95: levels[Math.floor(levels.length * 0.95)] };
  });
}

async function command(file, args, timeout = 10000) {
  try {
    const { stdout } = await exec(file, args, { timeout, maxBuffer: 2_000_000 });
    return stdout.trim();
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

async function resourceSample(seconds) {
  const [docker, gpu] = await Promise.all([
    command('docker', ['stats', '--no-stream', '--format', '{{json .}}', ...containers], 20000),
    command('nvidia-smi', ['--query-gpu=utilization.gpu,memory.used,power.draw', '--format=csv,noheader,nounits'], 10000),
  ]);
  const stats = typeof docker === 'string' ? docker.split(/\r?\n/u).filter(Boolean).map((line) => {
    try { return JSON.parse(line); } catch { return { error: line }; }
  }) : docker;
  return { seconds: Math.round(seconds * 10) / 10, at: new Date().toISOString(), docker: stats, gpu };
}

async function eventsAt(request, api, sessionId, elapsed, page) {
  const response = await request.get(`${api}/voice/sessions/${sessionId}/events`);
  if (!response.ok()) throw new Error(`Session events HTTP ${response.status()}`);
  const payload = await response.json();
  const counts = {};
  for (const event of payload.events) counts[event.type] = (counts[event.type] ?? 0) + 1;
  const downstream = payload.events.filter((event) => /voice\.(?:wake\.detected|audio\.|stt\.|thinking\.|tts\.|barge_in|error)/u.test(event.type));
  return { seconds: Math.round(elapsed * 10) / 10, at: new Date().toISOString(),
    sessionState: payload.session.state, sessionEndedAt: payload.session.endedAt,
    uiIdle: await page.getByText('Aguardando “Luna”', { exact: true }).first().isVisible(),
    uiConnected: await page.getByText(/Sessão conectada/u).isVisible(),
    eventCounts: counts, downstreamEvents: downstream.map((event) => ({ type: event.type, at: event.createdAt, data: event.data })) };
}

function numberValue(value) {
  const parsed = Number.parseFloat(String(value ?? '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

function bytes(value) {
  const match = /^\s*([\d.,]+)\s*(B|kB|MB|GB|TB|KiB|MiB|GiB|TiB)\s*$/iu.exec(String(value ?? ''));
  if (!match) return null;
  const amount = numberValue(match[1]);
  const factor = { B: 1, kB: 1000, MB: 1e6, GB: 1e9, TB: 1e12,
    KiB: 1024, MiB: 1024 ** 2, GiB: 1024 ** 3, TiB: 1024 ** 4 }[match[2]];
  return amount === null ? null : amount * factor;
}

function ioPair(value) {
  const parts = String(value ?? '').split('/');
  return parts.length === 2 ? { receivedBytes: bytes(parts[0]), sentBytes: bytes(parts[1]) } : null;
}

function summarize(samples) {
  const containerSummary = {};
  for (const name of containers) {
    const rows = samples.flatMap((sample) => Array.isArray(sample.docker) ? sample.docker.filter((row) => row.Name === name) : []);
    const cpu = rows.map((row) => numberValue(row.CPUPerc)).filter((value) => value !== null).sort((a, b) => a - b);
    const mem = rows.map((row) => bytes(row.MemUsage?.split('/')[0])).filter((value) => value !== null);
    const firstNet = ioPair(rows[0]?.NetIO);
    const lastNet = ioPair(rows.at(-1)?.NetIO);
    containerSummary[name] = { samples: rows.length,
      cpuPercentMean: cpu.length ? Math.round(cpu.reduce((sum, value) => sum + value, 0) / cpu.length * 100) / 100 : null,
      cpuPercentMedian: cpu.length ? cpu[Math.floor(cpu.length / 2)] : null,
      cpuPercentP95: cpu.length ? cpu[Math.min(cpu.length - 1, Math.floor(cpu.length * 0.95))] : null,
      cpuPercentMax: cpu.length ? cpu.at(-1) : null,
      memoryUsageFirst: rows[0]?.MemUsage ?? null, memoryUsageLast: rows.at(-1)?.MemUsage ?? null,
      memoryUsageMaxBytes: mem.length ? Math.max(...mem) : null,
      networkIOFirst: rows[0]?.NetIO ?? null, networkIOLast: rows.at(-1)?.NetIO ?? null,
      networkReceivedDeltaBytes: firstNet?.receivedBytes != null && lastNet?.receivedBytes != null
        ? lastNet.receivedBytes - firstNet.receivedBytes : null,
      networkSentDeltaBytes: firstNet?.sentBytes != null && lastNet?.sentBytes != null
        ? lastNet.sentBytes - firstNet.sentBytes : null };
  }
  return containerSummary;
}

function gpuSummary(samples) {
  const rows = samples.flatMap((sample) => typeof sample.gpu === 'string'
    ? sample.gpu.split(/\r?\n/u).filter(Boolean).map((line) => line.split(',').map((cell) => numberValue(cell))) : []);
  const metric = (index) => {
    const values = rows.map((row) => row[index]).filter((value) => value !== null).sort((a, b) => a - b);
    return { median: values.length ? values[Math.floor(values.length / 2)] : null,
      p95: values.length ? values[Math.min(values.length - 1, Math.floor(values.length * 0.95))] : null,
      max: values.length ? values.at(-1) : null };
  };
  return { samples: rows.length, utilizationPercent: metric(0), memoryUsedMiB: metric(1), powerWatts: metric(2) };
}

async function main() {
  const minutes = Number(option('--minutes', '10'));
  if (![10, 30, 60].includes(minutes)) throw new Error('--minutes must be 10, 30, or 60');
  const diagnosticSeconds = Number(option('--seconds', '0'));
  if (!Number.isFinite(diagnosticSeconds) || diagnosticSeconds < 0 || diagnosticSeconds > 120) {
    throw new Error('--seconds is only for a 1–120 second diagnostic');
  }
  const systemMicrophone = process.argv.includes('--system-microphone');
  const targetSeconds = diagnosticSeconds || minutes * 60;
  const web = option('--web-url', process.env.WEB_URL ?? 'http://127.0.0.1:3000').replace(/\/$/u, '');
  const api = option('--api-url', process.env.API_URL ?? 'http://127.0.0.1:8000').replace(/\/$/u, '');
  const selectedAmbient = option('--ambient-file', null);
  const source = systemMicrophone ? null : resolve(selectedAmbient ?? await defaultAmbientFile());
  const reportName = `browser-idle-${diagnosticSeconds ? `${diagnosticSeconds}sec` : `${minutes}min`}-${new Date().toISOString().replace(/[:.]/gu, '-')}.json`;
  const reportPath = join(root, 'tools/wakeword-training/reports', reportName);
  const temporary = await mkdtemp(join(tmpdir(), 'luna-browser-idle-'));
  const fakeMicPath = join(temporary, 'ambient.wav');
  const input = source ? await recordedMicrophone(source, targetSeconds + 20, fakeMicPath)
    : { source: 'system-microphone', repeated: 0 };
  const startedAt = new Date().toISOString();
  const browser = await chromium.launch({ channel: 'msedge', headless: true,
    args: source ? ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
      '--autoplay-policy=no-user-gesture-required', `--use-file-for-fake-audio-capture=${fakeMicPath}`] :
      ['--autoplay-policy=no-user-gesture-required'] });
  let context;
  let page;
  let sessionId;
  const samples = [];
  const checkpoints = [];
  const pageErrors = [];
  const socketTraffic = { sentFrames: 0, sentBinaryFrames: 0, sentBinaryBytes: 0, receivedFrames: 0, closed: 0 };
  try {
    context = await browser.newContext({ permissions: ['microphone'] });
    page = await context.newPage();
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('websocket', (socket) => {
      if (!socket.url().includes('/voice/ws')) return;
      socket.on('framesent', (frame) => {
        socketTraffic.sentFrames += 1;
        if (Buffer.isBuffer(frame.payload)) {
          socketTraffic.sentBinaryFrames += 1;
          socketTraffic.sentBinaryBytes += frame.payload.length;
        }
      });
      socket.on('framereceived', () => { socketTraffic.receivedFrames += 1; });
      socket.on('close', () => { socketTraffic.closed += 1; });
    });
    await page.goto(`${web}/voice`);
    await page.waitForURL(/\/voice\/[0-9a-f-]{36}(?:\?.*)?$/u, { timeout: 30000 });
    if (systemMicrophone) {
      input.measurement = await measureSystemMicrophone(page);
      if (input.measurement.rmsP95 < 0.0005) throw new Error(`System microphone is effectively silent: ${JSON.stringify(input.measurement)}`);
    }
    await page.getByRole('button', { name: 'Wake', exact: true }).waitFor({ timeout: 20000 });
    if (await page.getByRole('button', { name: 'Wake', exact: true }).getAttribute('aria-pressed') !== 'true') {
      await page.getByRole('button', { name: 'Wake', exact: true }).click();
    }
    await page.getByRole('button', { name: 'Ativar microfone' }).click();
    await page.getByText(/Sessão conectada/u).waitFor({ timeout: 20000 });
    const footer = await page.locator('footer').innerText();
    sessionId = /VoiceSession ([0-9a-f-]{36})/iu.exec(footer)?.[1];
    if (!sessionId) throw new Error(`VoiceSession ID missing in UI footer: ${footer}`);
    await page.evaluate(() => {
      const frames = { startedAt: performance.now(), previousAt: 0, intervals: [] };
      window.__lunaIdleFrames = frames;
      const tick = (at) => {
        if (frames.previousAt) frames.intervals.push(at - frames.previousAt);
        frames.previousAt = at;
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    const start = performance.now();
    const checkpointSeconds = [10, 30, 60].map((value) => value * 60).filter((value) => value <= targetSeconds);
    let nextSample = 0;
    let nextCheckpoint = 0;
    console.log(JSON.stringify({ phase: 'started', sessionId, startedAt, minutes, targetSeconds, source: input.source, reportPath }));
    while (true) {
      const elapsed = (performance.now() - start) / 1000;
      if (elapsed >= nextSample) {
        samples.push(await resourceSample(elapsed));
        await writeFile(reportPath, JSON.stringify({ phase: 'sampling', startedAt, sessionId, requestedSeconds: targetSeconds, input,
          socketTraffic, checkpoints, resources: { sampleIntervalSeconds: 30,
            containerSummary: summarize(samples), gpuSummary: gpuSummary(samples), samples }, pageErrors }, null, 2) + '\n');
        nextSample += 30;
      }
      if (nextCheckpoint < checkpointSeconds.length && elapsed >= checkpointSeconds[nextCheckpoint]) {
        const point = await eventsAt(context.request, api, sessionId, elapsed, page);
        checkpoints.push(point);
        await writeFile(reportPath, JSON.stringify({ phase: 'checkpoint', startedAt, sessionId, requestedSeconds: targetSeconds, input,
          socketTraffic, checkpoints, resources: { sampleIntervalSeconds: 30,
            containerSummary: summarize(samples), gpuSummary: gpuSummary(samples), samples }, pageErrors }, null, 2) + '\n');
        console.log(JSON.stringify({ phase: 'checkpoint', minute: checkpointSeconds[nextCheckpoint] / 60,
          sessionId, elapsedSeconds: point.seconds, uiIdle: point.uiIdle,
          downstreamEvents: point.downstreamEvents.length, eventCounts: point.eventCounts,
          wakeCpuMedian: summarize(samples)['luna-v2-wakeword'].cpuPercentMedian }));
        nextCheckpoint += 1;
      }
      if (elapsed >= targetSeconds && nextCheckpoint >= checkpointSeconds.length) break;
      await sleep(1000);
    }
    const durationSeconds = (performance.now() - start) / 1000;
    const final = await eventsAt(context.request, api, sessionId, durationSeconds, page);
    const uiFrames = await page.evaluate(() => {
      const frames = window.__lunaIdleFrames;
      const elapsedSeconds = (performance.now() - frames.startedAt) / 1000;
      const intervals = [...frames.intervals].sort((a, b) => a - b);
      return { measuredSeconds: Math.round(elapsedSeconds * 10) / 10,
        frames: intervals.length, fps: Math.round(intervals.length / elapsedSeconds * 10) / 10,
        frameIntervalMedianMs: intervals[Math.floor(intervals.length / 2)] ?? null,
        frameIntervalP95Ms: intervals[Math.min(intervals.length - 1, Math.floor(intervals.length * 0.95))] ?? null };
    });
    if (await page.getByRole('button', { name: 'Desligar microfone' }).isVisible()) {
      await page.getByRole('button', { name: 'Desligar microfone' }).click();
    }
    const end = await context.request.post(`${api}/voice/sessions/${sessionId}/end`);
    if (!end.ok()) pageErrors.push(`Session end HTTP ${end.status()}`);
    const report = { startedAt, completedAt: new Date().toISOString(), durationSeconds: Math.round(durationSeconds * 10) / 10,
      requestedSeconds: targetSeconds, sessionId, input, browser: { name: 'Edge/Chromium', headless: true, fakeMicrophone: Boolean(source),
        note: source ? 'Recorded ambient looped. This is a real-time browser path test, not independent background hours; the default source was used in training.' :
          'Actual system microphone captured live, after a three-second input-level check.' },
      socketTraffic, uiFrames, checkpoints, final, resources: { sampleIntervalSeconds: 30, containerSummary: summarize(samples),
        gpuSummary: gpuSummary(samples), samples,
        note: 'Docker CPU/network and nvidia-smi are shared with other sessions and host workloads.' },
      pageErrors, passed: !pageErrors.length && checkpoints.every((point) => point.uiIdle && point.uiConnected && !point.downstreamEvents.length) &&
        final.uiIdle && final.uiConnected && !final.downstreamEvents.length };
    await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({ phase: 'complete', reportPath, sessionId, durationSeconds: report.durationSeconds,
      passed: report.passed, downstreamEvents: final.downstreamEvents, pageErrors, socketTraffic,
      wakeResourceSummary: report.resources.containerSummary['luna-v2-wakeword'] }));
    if (!report.passed) process.exitCode = 1;
  } finally {
    if (sessionId && context) await context.request.post(`${api}/voice/sessions/${sessionId}/end`).catch(() => undefined);
    await context?.close();
    await browser.close();
    await rm(temporary, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
