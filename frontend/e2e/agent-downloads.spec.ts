import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('uptimex_novidades_vista', '1.4.0'));
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    return route.fulfill({ json: path === '/api/auth/me' ? { user: { id: 1, username: 'noc', role: 'admin' } } : path.includes('empresas') ? [] : {} });
  });
  await page.goto('/empresas');
});

async function openDownloads(page: import('@playwright/test').Page) {
  await page.getByTitle('Meu perfil', { exact: true }).click();
  await page.getByRole('menuitem', { name: 'Agente uptimeX', exact: true }).click();
}

test('oferece downloads publicados e fecha com Escape', async ({ page }, info) => {
  const artifact = (name: string) => ({ url: '/downloads/' + name, bytes: 48000, sha256: 'a'.repeat(64) });
  await page.route('**/downloads/agent-manifest.json', route => route.fulfill({ json: {
    version: '0.1.0', windows: artifact('uptimeX-Agent-Windows.exe'), python: artifact('uptimeX-Agent-Python.zip'),
  } }));
  await openDownloads(page);
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('link', { name: /Baixar Windows/ })).toHaveAttribute('href', '/downloads/uptimeX-Agent-Windows.exe');
  await expect(dialog.getByRole('link', { name: /Baixar Linux/ })).toContainText('47 KB');
  await expect(dialog).toContainText('a instalação de um agente Windows ainda não está disponível');
  const fits = await dialog.evaluate(element => element.getBoundingClientRect().right <= window.innerWidth && element.scrollWidth <= element.clientWidth);
  expect(fits).toBe(true);
  await page.screenshot({ path: info.outputPath('agent-downloads.png'), fullPage: true });
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});

test('sem pacotes mostra indisponibilidade sem links quebrados', async ({ page }) => {
  await page.route('**/downloads/agent-manifest.json', route => route.fulfill({ status: 404, body: '' }));
  await openDownloads(page);
  await expect(page.getByText('Pacote ainda não publicado nesta instalação.')).toHaveCount(2);
  await expect(page.getByRole('dialog').getByRole('link')).toHaveCount(0);
});

test('recusa URL externa no manifesto', async ({ page }) => {
  await page.route('**/downloads/agent-manifest.json', route => route.fulfill({ json: {
    version: '0.1.0', windows: { url: 'https://example.com/agent.exe', bytes: 10, sha256: 'a'.repeat(64) }, python: null,
  } }));
  await openDownloads(page);
  await expect(page.getByText('Pacote ainda não publicado nesta instalação.')).toHaveCount(2);
  await expect(page.getByRole('dialog').getByRole('link')).toHaveCount(0);
});
