import { expect, test } from "@playwright/test";

// Login (#9). O CI não sobe o Supabase neste job: o Auth aponta para um endereço sem serviço
// (playwright.config.ts). O fluxo completo do link mágico foi testado à mão com o Supabase
// local (descrito no PR); aqui ficam a tela, a proteção das rotas e os caminhos de erro.

test.describe("login", () => {
  test("/entrar mostra os dois jeitos de entrar, grandes e à vista", async ({ page }) => {
    const response = await page.goto("/entrar");
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Entrar");

    const google = page.getByRole("button", { name: "Entrar com Google" });
    const email = page.getByRole("button", { name: "Receber link por e-mail" });
    await expect(google).toBeVisible();
    await expect(email).toBeVisible();
    await expect(page.getByLabel("Seu e-mail")).toBeVisible();
    // Botão grande: alvo de toque bem acima do mínimo de 44 px.
    for (const button of [google, email]) expect((await button.boundingBox())?.height).toBeGreaterThanOrEqual(56);
  });

  test("rota protegida sem sessão vai para /entrar guardando o destino", async ({ page }) => {
    await page.goto("/inicio");
    await expect(page).toHaveURL(/\/entrar\?next=%2Finicio$/);
  });

  test("negado por padrão: rota desconhecida sem sessão também vai para /entrar", async ({ page }) => {
    await page.goto("/rota-que-nao-existe");
    await expect(page).toHaveURL(/\/entrar\?next=/);
  });

  test("cookie de sessão forjado não entra", async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: "sb-app-auth-token", value: "base64-e30", url: baseURL as string }]);
    await page.goto("/inicio");
    await expect(page).toHaveURL(/\/entrar/);
  });

  test("Google: o botão leva ao /auth/v1/authorize com PKCE e retorno para o callback", async ({ page, baseURL }) => {
    let authorize: URL | undefined;
    await page.route("http://127.0.0.1:9/auth/v1/authorize**", (route) => {
      authorize = new URL(route.request().url());
      return route.fulfill({ status: 200, body: "ok" });
    });
    await page.goto("/entrar?next=%2Finicio");
    await page.getByRole("button", { name: "Entrar com Google" }).click();
    await expect.poll(() => authorize?.searchParams.get("provider")).toBe("google");
    expect(authorize?.searchParams.get("code_challenge_method")).toBe("s256");
    expect(authorize?.searchParams.get("redirect_to")).toBe(`${baseURL}/auth/callback?next=%2Finicio`);
  });

  test("e-mail: Auth fora do ar mostra aviso e o e-mail não aparece na tela nem na URL", async ({ page }) => {
    const email = "pessoa.teste@exemplo.org";
    await page.goto("/entrar");
    await page.getByLabel("Seu e-mail").fill(email);
    await page.getByRole("button", { name: "Receber link por e-mail" }).click();
    await expect(page).toHaveURL(/erro=unavailable/);
    await expect(page.getByRole("main").getByRole("alert")).toHaveText(/indisponível/);
    expect(page.url()).not.toContain("exemplo.org");
    await expect(page.getByRole("main")).not.toContainText(email);
    await expect(page.getByLabel("Seu e-mail")).toHaveValue("");
  });

  test("retorno sem código válido é negado", async ({ page }) => {
    await page.goto("/auth/callback?next=%2Finicio");
    await expect(page).toHaveURL(/\/entrar\?erro=failed$/);
    await expect(page.getByRole("main").getByRole("alert")).toBeVisible();
  });

  test("texto da URL nunca vira mensagem na tela", async ({ page }) => {
    await page.goto("/entrar?erro=%3Cb%3Einvadido%3C%2Fb%3E");
    await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
    await expect(page.getByRole("main")).not.toContainText("invadido");
  });
});
