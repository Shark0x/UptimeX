import { expect, test } from '@playwright/test';

const empresa = { id: 7, nome: 'Acme NOC', descricao: '', foto_url: null, endereco: null, latitude: null, longitude: null };

// O dispositivo começa offline ("sem resposta"); após o teste de ping o backend
// (mockado) devolve online e a relistagem reflete a recuperação.
function dispositivo(online: boolean) {
  return {
    id: 6, empresa_id: 7, nome: 'Borda principal', ip: '1.1.1.1', fabricante: 'generico',
    metodo_monitoramento: 'ping', comunidade_snmp_configurada: false, porta_snmp: 161,
    intervalo_polling_seg: 30, status_atual: online ? 'online' : 'offline',
    ultima_verificacao: '2026-08-19T12:00:00', latencia_ms: online ? 12 : null,
    perda_pct: online ? 0 : 100, ativo: true,
  };
}

test('botão Testar ping força a verificação e mostra o resultado', async ({ page }) => {
  let online = false;

  await page.route('**/api/**', async (route) => {
    const caminho = new URL(route.request().url()).pathname;
    const metodo = route.request().method();
    let body: unknown = {};

    if (caminho === '/api/auth/me') body = { user: { id: 1, username: 'noc', role: 'admin' } };
    else if (caminho === '/api/empresas') body = [empresa];
    else if (caminho === '/api/dispositivos/empresa/7' && metodo === 'GET') body = [dispositivo(online)];
    else if (caminho === '/api/dispositivos/empresa/7/verificar' && metodo === 'POST') {
      online = true; // a próxima listagem mostra a recuperação
      body = { total: 1, resultados: [{ id: 6, nome: 'Borda principal', online: true, latenciaMs: 12, perdaPct: 0 }] };
    }

    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
  });

  // auth/me já devolve logado como admin → cai direto na aba Status da empresa 7.
  await page.goto('/empresas/7/status');

  await expect(page.getByText('Borda principal')).toBeVisible();
  const botao = page.getByRole('button', { name: /Testar ping/i });
  await expect(botao).toBeVisible();

  await botao.click();

  // Toast de sucesso (1/1 respondeu) + a relistagem reflete o dispositivo no ar.
  await expect(page.getByText(/1\/1 responderam/i)).toBeVisible();
});
