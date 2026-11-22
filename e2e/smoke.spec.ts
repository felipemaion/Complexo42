import { expect, test } from "@playwright/test";

test.describe("fumaça: página inicial", () => {
  test("carrega com título, idioma e estrutura acessível", async ({ page }) => {
    const response = await page.goto("/");
    expect(response?.status()).toBe(200);

    await expect(page.locator("html")).toHaveAttribute("lang", "pt-BR");
    await expect(page).toHaveTitle(/\S/);

    // Sanidade de acessibilidade sem dependência extra: um único h1 e um landmark main.
    const heading = page.getByRole("heading", { level: 1 });
    await expect(heading).toHaveCount(1);
    // Entrada "Cinema" (22/11): frase em três linhas, vinda de config/instance.ts (home.hero).
    await expect(heading).toHaveText("Sua equipe. Sua região. Sua história.");
    await expect(page.getByRole("main")).toBeVisible();
    // Fora da demonstração, o único caminho é entrar.
    await expect(page.getByRole("link", { name: "Entrar na plataforma" })).toHaveAttribute("href", "/entrar");

    // Ainda sem lançamento: não deve ser indexada.
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  });

  test("tela de espera mostra o texto da configuração, sem dado de ninguém", async ({ page }) => {
    const response = await page.goto("/espera");
    expect(response?.status()).toBe(200);
    const heading = page.getByRole("heading", { level: 1 });
    await expect(heading).toHaveCount(1);
    await expect(heading).toHaveText("Seu cadastro está em análise");
    await expect(page.getByRole("main")).toContainText("lista de pessoas autorizadas");
  });

  // Rota inexistente sem sessão não chega ao 404: o login nega por padrão e manda para /entrar
  // (e2e/auth.spec.ts, #9). Assim, quem não entrou não descobre quais rotas existem.
});
