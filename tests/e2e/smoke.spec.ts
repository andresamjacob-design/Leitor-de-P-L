import { expect, test } from "@playwright/test";

/**
 * The Fase 1 happy path. It runs with or without a Supabase project configured: without
 * one, the login screen says so instead of pretending; with one, the magic-link form is
 * there. Either way, an anonymous visitor never reaches an entity screen.
 */

test("a rota raiz leva para o login quando ninguém está autenticado", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole("heading", { name: "Financeiro" })).toBeVisible();
});

test("uma entidade não é acessível sem sessão", async ({ page }) => {
  await page.goto("/dd-group/fluxo-de-caixa");
  await expect(page).toHaveURL(/\/login/);
});

test("o login pede e-mail, ou avisa que falta configuração", async ({ page }) => {
  await page.goto("/login");

  const emailField = page.getByLabel("E-mail");
  const notConfigured = page.getByText("Supabase não configurado");

  await expect(emailField.or(notConfigured).first()).toBeVisible();
});

test("a página está em português do Brasil", async ({ page }) => {
  await page.goto("/login");
  await expect(page.locator("html")).toHaveAttribute("lang", "pt-BR");
});

/**
 * Fase 2 added screens that read and write the ledger. Without a session none of them may
 * answer — the middleware turns them away before any query runs, and RLS would refuse
 * anyway (DECISIONS D16).
 */
for (const path of [
  "/dd-group/lancamentos",
  "/dd-group/lancamentos/novo",
  "/dd-group/contas",
  "/dd-group/plano-de-contas",
]) {
  test(`${path} exige sessão`, async ({ page }) => {
    await page.goto(path);
    await expect(page).toHaveURL(/\/login/);
  });
}

test("a tela de importações exige sessão", async ({ page }) => {
  await page.goto("/dd-group/importacoes");
  await expect(page).toHaveURL(/\/login/);
});

for (const path of ["/dd-group/regras", "/dd-group/regras/nova", "/dd-group/assinaturas"]) {
  test(`${path} exige sessão`, async ({ page }) => {
    await page.goto(path);
    await expect(page).toHaveURL(/\/login/);
  });
}

for (const path of [
  "/dd-group/contratos",
  "/dd-group/contratos/novo",
  "/dd-group/clientes",
  "/dd-group/notas-fiscais",
  "/dd-group/pessoas",
]) {
  test(`${path} exige sessão`, async ({ page }) => {
    await page.goto(path);
    await expect(page).toHaveURL(/\/login/);
  });
}

for (const path of ["/dd-group/dre", "/dd-group/competencia", "/dd-group/receita", "/dd-group/folha"]) {
  test(`${path} exige sessão`, async ({ page }) => {
    await page.goto(path);
    await expect(page).toHaveURL(/\/login/);
  });
}

test("a tela de leitura de contrato exige sessão", async ({ page }) => {
  await page.goto("/dd-group/contratos/extrair");
  await expect(page).toHaveURL(/\/login/);
});
