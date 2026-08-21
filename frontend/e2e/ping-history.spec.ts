import { expect, test } from '@playwright/test';

function pontos(quantidade: number, horasEntrePontos: number) {
  const inicio = new Date('2026-08-01T00:00:00');
  return Array.from({ length: quantidade }, (_, indice) => {
    const timestamp = new Date(inicio.getTime() + indice * horasEntrePontos * 3_600_000);
    return {
      timestamp: timestamp.toISOString().slice(0, 19),
      avg_latency: 24 + (indice % 7) * 3,
      min_latency: 18 + (indice % 4),
      max_latency: indice % 11 === 0 ? 182 : 48 + (indice % 8) * 4,
      packet_loss_pct: indice % 11 === 0 ? 4.5 : 0.2,
      uptime_pct: indice % 11 === 0 ? 96 : 100,
      degraded_pct: indice % 11 === 0 ? 4 : 0,
    };
  });
}

test('exibe histórico consolidado responsivo e troca o período', async ({ page }, testInfo) => {
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const caminho = url.pathname;
    let body: unknown = {};
    let status = 200;

    if (caminho === '/api/auth/me') {
      body = { user: { id: 1, username: 'noc', role: 'admin' } };
    } else if (caminho === '/api/empresas') {
      body = [{ id: 7, nome: 'Acme NOC', descricao: 'Operação principal', foto_url: null, endereco: null, latitude: null, longitude: null }];
    } else if (caminho === '/api/empresas/resumo-status') {
      body = [{ id: 7, nome: 'Acme NOC', foto_url: null, endereco: null, total: 1, online: 1, offline: 0, degradados: 0, desconhecidos: 0, links_dedicados: 0, offline_desde: null }];
    } else if (caminho === '/api/dispositivos/empresa/7') {
      body = [{ id: 6, empresa_id: 7, nome: 'Borda principal', ip: '1.1.1.1', fabricante: 'generico', metodo_monitoramento: 'ping', comunidade_snmp_configurada: false, porta_snmp: 161, intervalo_polling_seg: 30, status_atual: 'online', ultima_verificacao: '2026-08-19T12:00:00', latencia_ms: 25, perda_pct: 0, ativo: true }];
    } else if (caminho === '/api/empresas/7/ping-history') {
      body = url.searchParams.get('range') === '90d' ? pontos(90, 24) : pontos(96, 0.25);
    } else if (caminho === '/api/dispositivos/6/historico') {
      body = [];
    } else if (caminho === '/api/empresas/7/foto') {
      status = 404;
      body = { erro: 'Foto não encontrada' };
    }

    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  });

  await page.goto('/');
  await page.getByRole('button', { name: /Acme NOC/ }).first().click();
  await page.getByRole('button', { name: 'Histórico' }).click();

  await expect(page.getByRole('heading', { name: 'Disponibilidade consolidada · Acme NOC' })).toBeVisible();
  await expect(page.getByRole('button', { name: '24h' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('amostras raw · 1 ponto/5 min')).toBeVisible();

  const resposta90d = page.waitForResponse((resposta) =>
    resposta.url().includes('/api/empresas/7/ping-history?range=90d')
  );
  await page.getByRole('button', { name: '90d' }).click();
  await resposta90d;
  await expect(page.getByText('rollup diário · 1 ponto/dia')).toBeVisible();
  await expect(page.getByText('Ver dados do gráfico (90 pontos)')).toBeVisible();

  const temEstouroHorizontal = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(temEstouroHorizontal).toBe(false);
  expect(await page.evaluate(() => window.scrollX)).toBe(0);

  const caixaGrafico = await page
    .getByRole('heading', { name: 'Disponibilidade consolidada · Acme NOC' })
    .locator('xpath=ancestor::section')
    .boundingBox();
  const larguraViewport = page.viewportSize()?.width ?? 0;
  expect(caixaGrafico).not.toBeNull();
  expect(caixaGrafico!.x).toBeGreaterThanOrEqual(0);
  expect(caixaGrafico!.x + caixaGrafico!.width).toBeLessThanOrEqual(larguraViewport + 1);

  await page.screenshot({ path: testInfo.outputPath('ping-history.png'), fullPage: true });
});
