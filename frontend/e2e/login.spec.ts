import { expect, test } from '@playwright/test';

test('renderiza a tela de login e gera uma captura visual', async ({ page }, testInfo) => {
  const errosDoConsole: string[] = [];
  page.on('console', (mensagem) => {
    if (mensagem.type() === 'error') errosDoConsole.push(mensagem.text());
  });
  await page.route('**/api/auth/me', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ user: null }),
  }));

  await page.goto('/');

  await expect(page).toHaveTitle(/uptimeX/i);
  await expect(page.getByRole('heading', { name: 'Entrar na central' })).toBeVisible();
  await expect(page.locator('#login-usuario')).toBeVisible();
  await expect(page.locator('#login-senha')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Acessar a central' })).toBeVisible();

  const temEstouroHorizontal = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(temEstouroHorizontal).toBe(false);

  await page.screenshot({
    path: testInfo.outputPath('login.png'),
    fullPage: true,
  });

  expect(errosDoConsole).toEqual([]);
});
