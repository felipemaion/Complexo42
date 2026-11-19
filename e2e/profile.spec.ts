import { expect, test, type APIRequestContext, type Browser, type Page } from "@playwright/test";

// Formulário do perfil (#12). Sem Supabase (job "E2E" do CI): só a proteção da rota. Com o Supabase local
// e o Mailpit (como em e2e/auth-live.spec.ts), o fluxo real: entrar, cair no formulário, máscara,
// distrito só na capital, erros acessíveis, salvar e WhatsApp repetido. Para rodar:
//   E2E_LIVE_SUPABASE_URL=<API_URL> E2E_LIVE_ANON_KEY=<ANON_KEY> E2E_MAILPIT_URL=<Mailpit>
//   npm run test:e2e -- e2e/profile.spec.ts
// (`site_url` do supabase/config.toml apontando para http://127.0.0.1:3100.)
const MAILPIT = process.env.E2E_MAILPIT_URL;
const LIVE = Boolean(process.env.E2E_LIVE_SUPABASE_URL && MAILPIT);

test("/perfil sem sessão manda para o login, voltando ao formulário depois", async ({ page }) => {
  await page.goto("/perfil");
  await expect(page).toHaveURL(/\/entrar\?next=%2Fperfil$/);
});

test.describe("formulário com o Supabase local", () => {
  test.skip(!LIVE, "precisa do Supabase local e do Mailpit (ver o topo do arquivo)");
  test.describe.configure({ mode: "serial" });

  const run = Date.now();
  const emailA = `perfil.a.${run}@exemplo.org`;
  const emailB = `perfil.b.${run}@exemplo.org`;
  // Número fictício, diferente a cada execução (o banco recusa o mesmo WhatsApp duas vezes).
  const phone = `11 9${String(run).slice(-8)}`;

  async function latestLink(request: APIRequestContext, to: string, after: number): Promise<string> {
    for (let i = 0; i < 40; i++) {
      const list = await (await request.get(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}`)).json();
      const msg = (list.messages ?? []).find((m: { Created: string }) => Date.parse(m.Created) >= after);
      if (msg) {
        const full = await (await request.get(`${MAILPIT}/api/v1/message/${msg.ID}`)).json();
        const href = /href="([^"]+)"/.exec(full.HTML)?.[1];
        if (href) return href.replaceAll("&amp;", "&");
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error("e-mail não chegou");
  }

  /** Entra pelo link mágico num navegador novo, com tela de celular. */
  async function signIn(browser: Browser, request: APIRequestContext, email: string): Promise<Page> {
    const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true })).newPage();
    const at = Date.now() - 1000;
    await page.goto("/entrar");
    await page.getByLabel("Seu e-mail").fill(email);
    await expect(page.locator('input[name="cf-turnstile-response"]')).not.toHaveValue("", { timeout: 20_000 });
    await page.getByRole("button", { name: "Receber link por e-mail" }).click();
    await expect(page.getByRole("main").getByRole("status")).toBeVisible();
    await page.goto(await latestLink(request, email, at));
    await page.getByRole("button", { name: "Entrar" }).click();
    return page;
  }

  test("quem ainda não tem perfil cai no formulário; erros, máscara e distrito", async ({ browser, request, baseURL }) => {
    const page = await signIn(browser, request, emailA);
    await expect(page).toHaveURL(`${baseURL}/perfil`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Seus dados");

    // Tudo com rótulo; botão grande e sem rolagem lateral no celular.
    const name = page.getByLabel("Seu nome");
    const whatsapp = page.getByLabel("Seu WhatsApp, com DDD");
    const city = page.getByLabel("Sua cidade");
    const save = page.getByRole("button", { name: "Salvar meus dados" });
    expect((await save.boundingBox())?.height).toBeGreaterThanOrEqual(56);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    // Enviar vazio: o servidor recusa, o resumo recebe o foco e cada campo diz o que falta.
    await save.click();
    const summary = page.getByRole("main").getByRole("alert");
    await expect(summary).toBeFocused();
    await expect(summary).toContainText("Falta arrumar alguns campos");
    await expect(name).toHaveAttribute("aria-invalid", "true");
    await expect(name).toHaveAccessibleDescription(/Escreva seu nome/);
    await expect(whatsapp).toHaveAttribute("aria-invalid", "true");
    await expect(city).toHaveAttribute("aria-invalid", "true");

    // Máscara: digitado só com números, aparece no formato nacional.
    await whatsapp.fill("");
    await whatsapp.pressSequentially("11987654321");
    await expect(whatsapp).toHaveValue("(11) 98765-4321");

    // Distrito só na capital.
    const district = page.getByLabel("Seu distrito");
    await expect(district).toHaveCount(0);
    await city.selectOption({ label: "São Paulo" });
    await expect(district).toBeVisible();
    await city.selectOption({ label: "Guarulhos" });
    await expect(district).toHaveCount(0);

    // Celular inválido: só ele volta com erro, e o que foi digitado continua lá.
    await name.fill("Pessoa de Teste");
    await whatsapp.fill("(11) 3456-7890");
    await save.click();
    await expect(page.getByRole("main").getByRole("alert")).toBeFocused();
    await expect(whatsapp).toHaveAttribute("aria-invalid", "true");
    await expect(name).not.toHaveAttribute("aria-invalid", "true");
    await expect(name).toHaveValue("Pessoa de Teste");
    await expect(city).toHaveValue("3518800");

    // Válido, na capital com distrito: salva e segue para o portão de acesso. O e-mail de teste
    // não está na lista de autorizados, então a pessoa vai para a espera (ADR 0008 §1).
    await whatsapp.fill(phone);
    await city.selectOption({ label: "São Paulo" });
    await district.selectOption("Sé");
    await save.click();
    await expect(page).toHaveURL(`${baseURL}/espera`);
    await expect(page.locator("body")).not.toContainText("Pessoa de Teste");
    await page.context().close();
  });

  test("o mesmo WhatsApp em outro cadastro: aviso claro, sem dizer de quem é", async ({ browser, request, baseURL }) => {
    // O Auth exige 60 s entre dois e-mails do mesmo IP só para o mesmo endereço; aqui é outro.
    const page = await signIn(browser, request, emailB);
    await expect(page).toHaveURL(`${baseURL}/perfil`);
    await page.getByLabel("Seu nome").fill("Outra Pessoa");
    await page.getByLabel("Seu WhatsApp, com DDD").fill(phone);
    await page.getByLabel("Sua cidade").selectOption({ label: "Osasco" });
    await page.getByRole("button", { name: "Salvar meus dados" }).click();
    const summary = page.getByRole("main").getByRole("alert");
    await expect(summary).toBeFocused();
    await expect(summary).toContainText("Este WhatsApp já está em outro cadastro");
    await expect(page.locator("body")).not.toContainText(emailA);
    await expect(page.locator("body")).not.toContainText("Pessoa de Teste");
    await expect(page.getByLabel("Seu nome")).toHaveValue("Outra Pessoa");
    await page.context().close();
  });
});
