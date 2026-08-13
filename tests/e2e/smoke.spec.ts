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
