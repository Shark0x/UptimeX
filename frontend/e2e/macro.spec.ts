import { expect, test } from '@playwright/test';

const empresas = [
  { id: 1, nome: 'Backbone Norte', endereco: 'PoP Centro · Fortaleza', foto_url: null, total: 6, online: 3, offline: 3, degradados: 0, desconhecidos: 0, links_dedicados: 2, offline_desde: new Date(Date.now() - 86 * 60_000).toISOString() },
  { id: 2, nome: 'Hospital São Lucas', endereco: 'Aldeota · Fortaleza', foto_url: null, total: 5, online: 4, offline: 1, degradados: 0, desconhecidos: 0, links_dedicados: 1, offline_desde: new Date(Date.now() - 22 * 60_000).toISOString() },
  { id: 3, nome: 'Distribuidora Atlântico', endereco: 'Maracanaú · Ceará', foto_url: null, total: 4, online: 2, offline: 2, degradados: 0, desconhecidos: 0, links_dedicados: 1, offline_desde: new Date(Date.now() - 7 * 60_000).toISOString() },
  { id: 4, nome: 'Shopping Beira Mar', endereco: 'Meireles · Fortaleza', foto_url: null, total: 8, online: 6, offline: 0, degradados: 2, desconhecidos: 0, links_dedicados: 2, offline_desde: null },
  { id: 5, nome: 'Indústria Horizonte', endereco: 'Distrito Industrial', foto_url: null, total: 5, online: 4, offline: 0, degradados: 1, desconhecidos: 0, links_dedicados: 1, offline_desde: null },
  { id: 6, nome: 'Escritório Regional Sul', endereco: 'Messejana · Fortaleza', foto_url: null, total: 3, online: 0, offline: 0, degradados: 0, desconhecidos: 3, links_dedicados: 0, offline_desde: null },
  { id: 7, nome: 'Nova sede em implantação', endereco: 'Caucaia · Ceará', foto_url: null, total: 0, online: 0, offline: 0, degradados: 0, desconhecidos: 0, links_dedicados: 0, offline_desde: null },
  { id: 8, nome: 'Clínica Vida', endereco: 'Centro · Fortaleza', foto_url: null, total: 4, online: 4, offline: 0, degradados: 0, desconhecidos: 0, links_dedicados: 1, offline_desde: null },
  { id: 9, nome: 'Faculdade Integração', endereco: 'Benfica · Fortaleza', foto_url: null, total: 7, online: 7, offline: 0, degradados: 0, desconhecidos: 0, links_dedicados: 2, offline_desde: null },
  { id: 10, nome: 'Grupo Meridian', endereco: 'Papicu · Fortaleza', foto_url: null, total: 3, online: 3, offline: 0, degradados: 0, desconhecidos: 0, links_dedicados: 1, offline_desde: null },
  { id: 11, nome: 'Logística Nordeste', endereco: 'Eusébio · Ceará', foto_url: null, total: 5, online: 5, offline: 0, degradados: 0, desconhecidos: 0, links_dedicados: 1, offline_desde: null },
  { id: 12, nome: 'Prefeitura Municipal', endereco: 'Centro Administrativo', foto_url: null, total: 9, online: 9, offline: 0, degradados: 0, desconhecidos: 0, links_dedicados: 3, offline_desde: null },
];

test('visão macro prioriza incidentes e mantém o layout responsivo', async ({ page }, testInfo) => {
  const errosDoConsole: string[] = [];
  page.on('console', (mensagem) => {
    if (mensagem.type() === 'error') errosDoConsole.push(mensagem.text());
  });

  await page.route('**/api/auth/login', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ user: { id: 1, username: 'noc.visual', role: 'admin' } }),
    });
  });
  await page.route('**/api/auth/me', async (route) => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ user: null }) });
  });
  await page.route('**/api/empresas/resumo-status', async (route) => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(empresas) });
  });
  await page.route('**/api/empresas', async (route) => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify([]) });
  });
  await page.route('**/socket.io/**', async (route) => {
    const headers = { 'access-control-allow-origin': 'http://127.0.0.1:5173', 'access-control-allow-credentials': 'true' };
    if (route.request().method() === 'POST') {
      await route.fulfill({ status: 200, headers, contentType: 'text/plain', body: 'ok' });
      return;
    }
    await route.fulfill({
      status: 200,
      headers,
      contentType: 'text/plain',
      body: '0{"sid":"e2e-socket","upgrades":[],"pingInterval":25000,"pingTimeout":20000,"maxPayload":1000000}',
    });
  });

  await page.goto('/');
  await page.locator('#login-usuario').fill('noc.visual');
  await page.locator('#login-senha').fill('teste-visual-seguro');
  await page.getByRole('button', { name: 'Acessar a central' }).click();
  await page.getByRole('button', { name: 'Visão Macro' }).click();

  await expect(page.getByRole('heading', { name: '3 EMPRESAS EM QUEDA' })).toBeVisible();
  await expect(page.getByText('Composição da frota')).toBeVisible();
  await expect(page.getByText('47 online', { exact: true })).toBeVisible();
  await expect(page.getByText('6 offline', { exact: true })).toBeVisible();
  await expect(page.getByText('59', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Exigem ação' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Operação estável' })).toBeVisible();

  const temEstouroHorizontal = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(temEstouroHorizontal).toBe(false);

  await page.screenshot({
    path: testInfo.outputPath('visao-macro.png'),
    fullPage: true,
  });

  await page.getByRole('button', { name: /Queda 3/i }).click();
  await expect(page.getByRole('heading', { name: 'Exigem ação' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Operação estável' })).toHaveCount(0);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  const animacaoSinal = await page.locator('.macro-command-deck .animate-sonar').evaluate(
    (elemento) => getComputedStyle(elemento).animationName,
  );
  expect(animacaoSinal).toBe('none');

  expect(errosDoConsole).toEqual([]);
});
