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
    await expect(heading).toHaveText("Em construção");
    await expect(page.getByRole("main")).toBeVisible();

    // Ainda em construção: não deve ser indexada.
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  });

  test("rota inexistente responde 404", async ({ page }) => {
    const response = await page.goto("/rota-que-nao-existe");
    expect(response?.status()).toBe(404);
  });
});
