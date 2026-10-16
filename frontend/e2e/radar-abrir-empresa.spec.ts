import { expect, test } from '@playwright/test';

// Duas empresas; coords nulas (irrelevantes pro radar, que lista todas). O bug:
// abrir a empresa 7 por deep link fixa empresaIdAlvo=7; clicar OUTRA (8) no radar
// do Mapa TV disparava o efeito de hidratação (id antigo ≠ clicada) e caía na Home.
const empresas = [
  { id: 7, nome: 'Empresa Alpha', descricao: '', foto_url: null, endereco: 'Centro · Ipatinga', latitude: null, longitude: null },
  { id: 8, nome: 'Empresa Beta', descricao: '', foto_url: null, endereco: 'Horto · Ipatinga', latitude: null, longitude: null },
];
const resumo = empresas.map((e) => ({
  id: e.id, nome: e.nome, foto_url: null, endereco: e.endereco,
  total: 1, online: 1, offline: 0, degradados: 0, desconhecidos: 0,
  links_dedicados: 0, link_30: false, offline_desde: null,
}));
const ESTILO_VAZIO = { version: 8, sources: {}, layers: [] };

test('abrir empresa pelo radar do Mapa TV abre a empresa certa (não cai na Home)', async ({ page }) => {
  await page.route('**/api/**', async (route) => {
    const caminho = new URL(route.request().url()).pathname;
    let body: unknown = {};
    if (caminho === '/api/auth/me') body = { user: { id: 1, username: 'noc', role: 'admin' } };
    else if (caminho === '/api/empresas') body = empresas;
    else if (caminho === '/api/empresas/resumo-status') body = resumo;
    else if (caminho.startsWith('/api/map/basemap/styles')) body = ESTILO_VAZIO;
    else if (caminho.startsWith('/api/dispositivos/empresa/')) body = [];
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.route('**/socket.io/**', (route) =>
    route.fulfill({
      status: 200,
      headers: { 'access-control-allow-origin': 'http://127.0.0.1:5173', 'access-control-allow-credentials': 'true' },
      contentType: 'text/plain',
      body: '0{"sid":"e2e","upgrades":[],"pingInterval":25000,"pingTimeout":20000,"maxPayload":1000000}',
    }),
  );

  // Deep link abre a empresa 7 (auth/me já loga) → fixa empresaIdAlvo=7.
  await page.goto('/empresas/7/status');
  await expect(page.getByRole('heading', { name: 'Empresa Alpha' })).toBeVisible();

  // Vai pro Mapa TV e, no radar, clica numa empresa DIFERENTE (Beta / id 8).
  await page.getByRole('button', { name: 'Mapa', exact: true }).click();
  await page.getByRole('button', { name: /Empresa Beta/i }).click();

  // Tem que abrir a Beta — não a Alpha (bug) nem a Home ("sair").
  await expect(page.getByRole('heading', { name: 'Empresa Beta' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Empresa Alpha' })).toHaveCount(0);

  // Cliques consecutivos: volta pro Mapa e clica a Alpha — tem que abrir a Alpha.
  await page.getByRole('button', { name: 'Mapa', exact: true }).click();
  await page.getByRole('button', { name: /Empresa Alpha/i }).click();
  await expect(page.getByRole('heading', { name: 'Empresa Alpha' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Empresa Beta' })).toHaveCount(0);

  // E de novo a Beta, pra garantir que cada clique abre SEMPRE a empresa clicada.
  await page.getByRole('button', { name: 'Mapa', exact: true }).click();
  await page.getByRole('button', { name: /Empresa Beta/i }).click();
  await expect(page.getByRole('heading', { name: 'Empresa Beta' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Empresa Alpha' })).toHaveCount(0);
});

// Fluxo EXATO do bug relatado pelo Kevin: abrir uma empresa → "Ver no mapa" (que
// leva ao radar SEM limpar empresaIdAlvo) → clicar OUTRA empresa no radar.
test('abrir empresa → Ver no mapa → clicar outra no radar abre a empresa clicada', async ({ page }) => {
  await page.route('**/api/**', async (route) => {
    const caminho = new URL(route.request().url()).pathname;
    let body: unknown = {};
    if (caminho === '/api/auth/me') body = { user: { id: 1, username: 'noc', role: 'admin' } };
    else if (caminho === '/api/empresas') body = empresas;
    else if (caminho === '/api/empresas/resumo-status') body = resumo;
    else if (caminho.startsWith('/api/map/basemap/styles')) body = ESTILO_VAZIO;
    else if (caminho.startsWith('/api/dispositivos/empresa/')) body = [];
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.route('**/socket.io/**', (route) =>
    route.fulfill({
      status: 200,
      headers: { 'access-control-allow-origin': 'http://127.0.0.1:5173', 'access-control-allow-credentials': 'true' },
      contentType: 'text/plain',
      body: '0{"sid":"e2e","upgrades":[],"pingInterval":25000,"pingTimeout":20000,"maxPayload":1000000}',
    }),
  );

  // Abre a Alpha (id 7) → fixa empresaIdAlvo=7.
  await page.goto('/empresas/7/status');
  await expect(page.getByRole('heading', { name: 'Empresa Alpha' })).toBeVisible();

  // "Ver no mapa" → vai pro Mapa TV (focado na Alpha), SEM limpar empresaIdAlvo.
  await page.getByRole('button', { name: /no mapa/i }).click();

  // No radar, clica a Beta (id 8) → tem que abrir a Beta, não reabrir a Alpha.
  await page.getByRole('button', { name: /Empresa Beta/i }).click();
  await expect(page.getByRole('heading', { name: 'Empresa Beta' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Empresa Alpha' })).toHaveCount(0);
});
