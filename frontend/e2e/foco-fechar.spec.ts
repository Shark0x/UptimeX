import { expect, test } from '@playwright/test';

// Empresa com coordenadas → o deep link /mapa?empresa=7 abre o balão de foco.
const empresas = [
  { id: 7, nome: 'Empresa Alpha', descricao: '', foto_url: null, endereco: 'Centro · Ipatinga', latitude: -19.47, longitude: -42.536 },
];
const resumo = [
  { id: 7, nome: 'Empresa Alpha', foto_url: null, endereco: 'Centro · Ipatinga', total: 1, online: 1, offline: 0, degradados: 0, desconhecidos: 0, links_dedicados: 0, link_30: false, offline_desde: null },
];
const ESTILO_VAZIO = { version: 8, sources: {}, layers: [] };

test('balão de foco: o × fecha e NÃO reabre (o relógio de 1s recriava o popup)', async ({ page }) => {
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

  // Deep link → Mapa TV com o balão de foco aberto.
  await page.goto('/mapa?empresa=7');

  const balao = page.locator('.tooltip-foco');
  await expect(balao).toBeVisible();
  await expect(balao.getByText('Empresa Alpha')).toBeVisible();

  // Clica no × do balão.
  await page.locator('.tooltip-foco .maplibregl-popup-close-button').click();

  // Fecha e CONTINUA fechado mesmo passando ticks do relógio de 1s (era o bug:
  // o popup reaparecia em ~1s porque o focoEmpresa era recriado a cada render).
  await expect(page.locator('.tooltip-foco')).toHaveCount(0);
  await page.waitForTimeout(1600);
  await expect(page.locator('.tooltip-foco')).toHaveCount(0);
});
