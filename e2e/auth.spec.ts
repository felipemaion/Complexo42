import { expect, test } from "@playwright/test";

// Login (#9). No job "E2E" do CI, sem Supabase, o Auth aponta para um endereço sem serviço
// (playwright.config.ts). O fluxo real do link mágico está em e2e/auth-live.spec.ts (job "E2E
// com banco"); aqui ficam a tela, a proteção das rotas e os caminhos de erro.

// Com o Supabase de verdade (E2E_LIVE_SUPABASE_URL), os testes que dependem do Auth fora do ar
// ficam de fora; o fluxo real está em e2e/auth-live.spec.ts.
const LIVE = Boolean(process.env.E2E_LIVE_SUPABASE_URL);

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

  test("Turnstile: o widget fica no formulário de e-mail, acima do botão, sem cobri-lo (#116)", async ({ page }) => {
    // Script do widget trocado por um falso: este teste é sobre a tela, não depende da rede.
    await page.route("https://challenges.cloudflare.com/turnstile/v0/api.js**", (route) =>
      route.fulfill({
        contentType: "text/javascript",
        body: `window.turnstile = {
          render(el, o) { el.dataset.sitekey = o.sitekey; el.style.height = "65px"; return "w1"; },
          remove() {},
        };`,
      }),
    );
    await page.goto("/entrar");
    const form = page.locator("form").filter({ has: page.getByLabel("Seu e-mail") });
    const widget = form.locator("[data-turnstile]");
    await expect(widget).toHaveAttribute("data-sitekey", "1x00000000000000000000AA");
    // O botão do Google não tem widget.
    await expect(page.locator("[data-turnstile]")).toHaveCount(1);
    const button = page.getByRole("button", { name: "Receber link por e-mail" });
    await expect(button).toBeVisible();
    const [w, b] = [await widget.boundingBox(), await button.boundingBox()];
    expect(w && b && w.y + w.height <= b.y).toBe(true);
  });

  test("Turnstile real com a chave de teste: o token entra no formulário e o envio segue neutro (#116)", async ({ page }) => {
    test.skip(LIVE, "precisa do Auth fora do ar");
    await page.goto("/entrar");
    // Sem rede até a Cloudflare (máquina offline), o widget não carrega: o teste é pulado. Os
    // casos de passa, falha, falta de token e siteverify fora do ar estão em turnstile.test.ts.
    const loaded = await page
      .waitForFunction(() => "turnstile" in window, undefined, { timeout: 15_000 })
      .then(() => true)
      .catch(() => false);
    test.skip(!loaded, "script do Turnstile inacessível (sem rede)");
    const token = page.locator('input[name="cf-turnstile-response"]');
    await expect(token).not.toHaveValue("", { timeout: 20_000 });
    await page.getByLabel("Seu e-mail").fill("pessoa.teste@exemplo.org");
    await page.getByRole("button", { name: "Receber link por e-mail" }).click();
    await expect(page).toHaveURL(/enviado=1/);
    await expect(page.getByRole("main").getByRole("status")).toHaveText(/Se este e-mail puder entrar/);
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
    test.skip(LIVE, "usa o endereço fictício do Auth");
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

  test("e-mail: resposta neutra mesmo com o Auth fora do ar; e-mail fora da tela e da URL (M4)", async ({ page }) => {
    test.skip(LIVE, "precisa do Auth fora do ar");
    const email = "pessoa.teste@exemplo.org";
    await page.goto("/entrar");
    await page.getByLabel("Seu e-mail").fill(email);
    await page.getByRole("button", { name: "Receber link por e-mail" }).click();
    await expect(page).toHaveURL(/enviado=1/);
    await expect(page.getByRole("main").getByRole("status")).toHaveText(/Se este e-mail puder entrar/);
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

  test("link mágico: o GET só mostra o botão Entrar, sem chamar o Auth (M1/M5)", async ({ page }) => {
    const authCalls: string[] = [];
    await page.route("http://127.0.0.1:9/**", (route) => {
      authCalls.push(route.request().url());
      return route.abort();
    });
    const response = await page.goto("/auth/confirmar?token_hash=pkce_abcdef123456&type=email");
    expect(response?.headers()["cache-control"]).toMatch(/no-store/);
    await expect(page.getByRole("button", { name: "Entrar" })).toBeVisible();
    await expect(page).toHaveURL(/\/auth\/confirmar/);
    expect(authCalls).toEqual([]);
  });

  test("link mágico antigo no callback vai para a página intermediária, sem login no GET", async ({ page }) => {
    await page.goto("/auth/callback?token_hash=pkce_abcdef123456&type=email");
    await expect(page).toHaveURL(/\/auth\/confirmar\?token_hash=pkce_abcdef123456&type=email$/);
    await expect(page.getByRole("button", { name: "Entrar" })).toBeVisible();
  });

  test("link mágico com parâmetros inválidos não mostra o botão", async ({ page }) => {
    await page.goto("/auth/confirmar?token_hash=%3Cx%3E&type=recovery");
    await expect(page.getByRole("button", { name: "Entrar" })).toHaveCount(0);
    await expect(page.getByRole("main").getByRole("alert")).toBeVisible();
  });

  test("POST do Entrar com Auth fora do ar falha fechado", async ({ page }) => {
    test.skip(LIVE, "precisa do Auth fora do ar");
    await page.goto("/auth/confirmar?token_hash=pkce_abcdef123456&type=email");
    await page.getByRole("button", { name: "Entrar" }).click();
    await expect(page).toHaveURL(/\/entrar\?erro=unavailable/);
  });

  test("matcher ancorado: /api/healthz-x e /favicon.ico.x passam pelo login (L1)", async ({ request }) => {
    for (const path of ["/api/healthz-x", "/favicon.ico.x", "/_next/static-x"]) {
      const res = await request.get(path, { maxRedirects: 0 });
      expect(res.status(), path).toBe(307);
      expect(res.headers()["location"], path).toMatch(/\/entrar\?next=/);
    }
    // O healthz de verdade continua fora do proxy (não redireciona; 503 sem banco).
    expect((await request.get("/api/healthz", { maxRedirects: 0 })).status()).not.toBe(307);
  });

  test("login e rotas de auth respondem com Cache-Control private, no-store (L3)", async ({ request }) => {
    for (const path of ["/entrar", "/auth/callback", "/auth/sair"]) {
      const res = await request.get(path, { maxRedirects: 0 });
      expect(res.headers()["cache-control"], path).toMatch(/private/);
      expect(res.headers()["cache-control"], path).toMatch(/no-store/);
    }
  });
});

// Token de uso único nunca na query do /entrar (achado do Oracle): o link antigo ({site}/verify?token=...) e
// qualquer rota protegida com credencial na query não podem copiar o token para a URL de login.
test("link antigo /verify com token vira /entrar sem query e avisa que o link é antigo", async ({ page }) => {
  await page.goto("/verify?token=segredo-de-uso-unico&type=magiclink");
  await expect(page).toHaveURL(/\/entrar\?erro=legacy_link$/);
  expect(page.url()).not.toContain("segredo");
  await expect(page.getByRole("alert")).toContainText("link");
});

test("rota protegida com credencial na query: o /entrar guarda só o caminho", async ({ page }) => {
  await page.goto("/inicio?token=segredo-de-uso-unico&code=abc&access_token=xyz");
  await expect(page).toHaveURL(/\/entrar\?next=%2Finicio$/);
  expect(page.url()).not.toMatch(/segredo|code=|access_token/);
});
