import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const url = process.env.WEB_URL;
if (!url) throw new Error('Set WEB_URL to the disposable web stack.');
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1050, height: 900 } });
  page.setDefaultTimeout(20_000);
  await page.goto(new URL('/settings', url));
  await page.getByRole('link', { name: /Personalidade/ }).click();
  await page.getByRole('heading', { name: 'Personalidade', exact: true }).waitFor();

  const original = page.getByRole('button', { name: /^Luna atual/ });
  const sagaz = page.getByRole('button', { name: /^Luna Sagaz Elegância/ });
  await original.waitFor();
  if (!(await page.getByRole('button', { name: 'Voltar para Luna atual' }).isDisabled())) {
    await page.getByRole('button', { name: 'Voltar para Luna atual' }).click();
    await page.getByRole('status').filter({ hasText: 'Luna atual vale' }).waitFor();
  }
  await sagaz.click();
  await page.getByRole('button', { name: 'Duplicar' }).click();
  await page.getByRole('textbox', { name: 'Nome', exact: true }).fill('Preset sintético de UI');
  await page.getByRole('textbox', { name: 'Jeito da Luna' }).fill('Seja direta e gentil.');
  await page.getByRole('combobox', { name: 'Tom' }).selectOption('acolhedor');
  const before = await (await page.request.get('/api/conversation')).json();
  await page.getByRole('textbox', { name: 'Mensagem de teste' }).fill('Responda apenas com o número 7.');
  await page.getByRole('button', { name: 'Testar', exact: true }).click();
  await page.getByRole('heading', { name: 'Preset sintético de UI', exact: true }).waitFor({ timeout: 85_000 });
  assert.equal(await page.getByRole('article').count(), 2);
  assert.equal((await (await page.request.get('/api/conversation')).json()).length, before.length);
  assert.equal((await (await page.request.get('/api/personality')).json()).activeId, 'luna-current');
  await page.getByRole('button', { name: 'Salvar preset' }).click();
  await page.getByRole('status').filter({ hasText: 'Preset salvo' }).waitFor();
  await page.getByRole('textbox', { name: 'Jeito da Luna' }).fill('Seja direta e acolhedora.');
  await page.getByRole('button', { name: 'Salvar preset' }).click();
  await page.getByRole('status').filter({ hasText: 'Preset salvo' }).waitFor();
  await page.getByRole('button', { name: 'Ativar preset' }).click();
  await page.getByRole('status').filter({ hasText: 'vale a partir' }).waitFor();
  await page.reload();
  await page.getByRole('heading', { name: 'Preset sintético de UI', exact: true }).waitFor();
  const saved = (await (await page.request.get('/api/personality')).json()).presets
    .find(item => item.name === 'Preset sintético de UI');
  assert.equal(saved.revision, 2);
  assert.equal(saved.tone, 'acolhedor');
  assert.equal(await page.getByRole('textbox', { name: 'Jeito da Luna' }).inputValue(), 'Seja direta e acolhedora.');
  await page.getByRole('button', { name: 'Voltar para Luna atual' }).click();
  await page.getByRole('status').filter({ hasText: 'Luna atual vale' }).waitFor();
  assert.equal((await (await page.request.get('/api/personality')).json()).activeId, 'luna-current');
  console.log('Personality browser smoke passed.');
} finally {
  await browser.close();
}
