import { expect, test } from '@playwright/test';

const empresas = [
  { id: 5, nome: 'ACME Ltda', descricao: '', foto_url: null, endereco: 'Centro · Ipatinga', latitude: -19.47, longitude: -42.536 },
];
const resumo = [
  { id: 5, nome: 'ACME Ltda', foto_url: null, endereco: 'Centro · Ipatinga', total: 1, online: 1, offline: 0, degradados: 0, desconhecidos: 0, links_dedicados: 0, link_30: false, offline_desde: null },
];
const ESTILO_VAZIO = { version: 8, sources: {}, layers: [] };

test.beforeEach(async ({ page }) => {
  await page.route('**/api/**', async (route) => {
    const caminho = new URL(route.request().url()).pathname;
    let body: unknown = {};
    if (caminho === '/api/auth/me') body = { user: { id: 1, username: 'noc', role: 'admin' } };
    else if (caminho === '/api/empresas') body = empresas;
    else if (caminho === '/api/empresas/resumo-status') body = resumo;
    else if (caminho.startsWith('/api/map/basemap/styles')) body = ESTILO_VAZIO;
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
});

test('menu 3 pontinhos abre sem abrir a empresa, e "Editar" abre o modal', async ({ page }) => {
  // auth/me já loga como admin → cai direto no Dashboard (aba Empresas).
  await page.goto('/empresas');
  await expect(page.getByRole('heading', { name: 'Painel de Configuração' })).toBeVisible();
  await expect(page.getByText('ACME Ltda').first()).toBeVisible();

  // Clicar nos 3 pontinhos abre o menu e NÃO navega pra empresa (stopPropagation).
  await page.getByRole('button', { name: /Menu de ações para ACME/i }).click();
  await expect(page.getByRole('menuitem', { name: /Editar empresa/i })).toBeVisible();
  await page.waitForTimeout(450); // deixa a animação de entrada do menu assentar
  await expect(page.getByRole('heading', { name: 'Painel de Configuração' })).toBeVisible();

  // "Editar empresa" abre o modal de edição (e também não navega).
  await page.getByRole('menuitem', { name: /Editar empresa/i }).click();
  await expect(page.getByRole('heading', { name: 'Editar empresa' })).toBeVisible();
  await expect(page.locator('input[maxlength="150"]')).toHaveValue('ACME Ltda'); // pré-preenchido
});

test('menu "Ver no mapa" foca a empresa certa no Mapa TV', async ({ page }) => {
  await page.goto('/empresas');
  await expect(page.getByText('ACME Ltda').first()).toBeVisible();

  await page.getByRole('button', { name: /Menu de ações para ACME/i }).click();
  await page.waitForTimeout(450);
  await page.getByRole('menuitem', { name: /Ver no mapa/i }).click();

  // Navegou pro Mapa TV e o balão de foco da empresa aparece. Sem o Number() no
  // verNoMapa, o id (string) nunca casava no MapaTV e o balão não surgia.
  const balao = page.locator('.tooltip-foco');
  await expect(balao).toBeVisible({ timeout: 10_000 });
  await expect(balao.getByText('ACME Ltda')).toBeVisible();
});
