import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const url = process.env.WEB_URL;
if (!url) throw new Error('Set WEB_URL to the isolated web stack.');
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ baseURL: url, viewport: { width: 1020, height: 850 } });
  page.setDefaultTimeout(20_000);
  await page.goto('/settings');
  await page.getByRole('link', { name: /Memórias da Luna/ }).click();
  await page.getByRole('heading', { name: 'Memórias da Luna' }).waitFor();
  const limit = page.getByRole('spinbutton', { name: 'Limite em tokens' });
  await limit.fill('321');
  await page.getByRole('button', { name: 'Salvar limite' }).click();
  await page.getByRole('status').filter({ hasText: 'Configuração salva' }).waitFor();
  assert.equal((await (await page.request.get('/api/memory')).json()).settings.fixedContextMaxTokens, 321);
  await limit.fill('512');
  await page.getByRole('button', { name: 'Salvar limite' }).click();
  await page.getByRole('status').filter({ hasText: 'Configuração salva' }).waitFor();
  await page.getByRole('button', { name: 'Nova memória', exact: true }).click();
  await page.getByRole('textbox', { name: 'Assunto', exact: true }).fill('Projeto UI');
  await page.getByRole('textbox', { name: 'Relação', exact: true }).fill('nome');
  await page.getByRole('textbox', { name: 'Valor da memória' }).fill('Lua de Papel');
  await page.getByLabel('Vigente desde').fill('2024-01-01');
  await page.getByRole('button', { name: 'Salvar memória' }).click();
  await page.getByRole('heading', { name: 'Editar memória' }).waitFor();
  await page.getByRole('textbox', { name: 'Valor da memória' }).fill('Lua de Vidro');
  await page.getByLabel('Vigente desde').fill('2025-05-01');
  await page.getByRole('combobox', { name: 'Tipo de alteração' }).selectOption('change');
  await page.getByRole('button', { name: 'Salvar memória' }).click();
  await page.getByText('Histórica · revisão 1', { exact: true }).waitFor();

  await page.getByRole('button', { name: 'Mapa', exact: true }).click();
  await page.getByRole('combobox', { name: 'Assunto', exact: true }).selectOption('Projeto UI');
  await page.getByLabel('Vigência em').fill('2025-03-10');
  await page.getByRole('button', { name: /Projeto UI · nome Lua de Papel/ }).waitFor();
  await page.getByRole('button', { name: /Projeto UI · nome Lua de Papel/ }).click();
  await page.getByRole('heading', { name: 'Linha do tempo e fontes' }).waitFor();
  await page.getByRole('button', { name: 'Esquecer', exact: true }).click();
  await page.getByRole('button', { name: 'Confirmar exclusão' }).click();
  await page.getByRole('status').filter({ hasText: 'Memória esquecida' }).waitFor();
  const result = await page.request.get('/api/memory');
  assert.match(result.headers()['cache-control'], /no-store/);
  const memory = await result.json();
  assert.ok(!memory.items.some(item => item.subject === 'Projeto UI'));
  console.log('Memory browser smoke passed.');
} finally {
  await browser.close();
}
