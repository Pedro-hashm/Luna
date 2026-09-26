const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');

(async () => {
  const browser = await chromium.launch({
    headless: true,
    channel: 'msedge',
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
  });
  let savedFile;
  try {
    const context = await browser.newContext({ permissions: ['microphone'] });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('http://localhost:3000/settings#voice');
    await page.getByRole('heading', { name: 'Treinamento da wake word' }).waitFor();
    await page.getByRole('button', { name: 'Gravar', exact: true }).nth(1).click();
    await page.getByRole('button', { name: 'Parar e salvar' }).waitFor();
    await page.waitForTimeout(1800);
    const upload = page.waitForResponse((response) => response.url().includes('/voice/training/recordings?category=negative') && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Parar e salvar' }).click();
    const response = await upload;
    const body = await response.json();
    if (response.status() !== 201 || !body.saved || body.category !== 'negative') throw new Error(`Upload failed: ${response.status()} ${JSON.stringify(body)}`);
    savedFile = body.fileName;
    await page.getByText('Gravação salva. As contagens foram atualizadas.').waitFor();
    const stats = await (await context.request.get('http://localhost:8000/voice/training/recordings/stats')).json();
    if (stats.negative < 1) throw new Error(`Stats did not increment: ${JSON.stringify(stats)}`);
    if (errors.length) throw new Error(`Page errors: ${errors.join('; ')}`);
    console.log(JSON.stringify({ recording: body, stats, pageErrors: errors }));
    await context.close();
  } finally {
    await browser.close();
    if (savedFile) {
      const root = path.resolve(__dirname, '../../../tools/wakeword-training/data/recordings/negative');
      const target = path.resolve(root, savedFile);
      if (!target.startsWith(root + path.sep)) throw new Error('Refusing to remove test recording outside dataset');
      fs.rmSync(target, { force: true });
      fs.rmSync(target.replace(/\.webm$/u, '.json'), { force: true });
      console.log(`Removed test recording: ${savedFile}`);
    }
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
