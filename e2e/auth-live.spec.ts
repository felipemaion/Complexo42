import { expect, test, type APIRequestContext } from "@playwright/test";

// Fluxo real do link mágico (#9), contra um Supabase local com o Mailpit. Não roda no CI (o job
// de E2E não sobe o Supabase). Para rodar:
//   1. `npm run db:start` com `site_url` do supabase/config.toml apontando para a porta do E2E
//      (http://127.0.0.1:3100) e o Mailpit ligado;
//   2. E2E_LIVE_SUPABASE_URL=<API_URL> E2E_LIVE_ANON_KEY=<ANON_KEY> E2E_MAILPIT_URL=<Mailpit>
//      npm run test:e2e
const MAILPIT = process.env.E2E_MAILPIT_URL;
test.skip(!process.env.E2E_LIVE_SUPABASE_URL || !MAILPIT, "precisa do Supabase local e do Mailpit");
test.describe.configure({ mode: "serial" });

const email = `pessoa.e2e.${Date.now()}@exemplo.org`;

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

async function requestLink(page: import("@playwright/test").Page): Promise<number> {
  const at = Date.now() - 1000;
  await page.goto("/entrar");
  await page.getByLabel("Seu e-mail").fill(email);
  // Turnstile (#116) com a chave de teste que sempre passa: sem o token, o e-mail não sai.
  await expect(page.locator('input[name="cf-turnstile-response"]')).not.toHaveValue("", { timeout: 20_000 });
  await page.getByRole("button", { name: "Receber link por e-mail" }).click();
  await expect(page.getByRole("main").getByRole("status")).toHaveText(/Se este e-mail puder entrar/);
  return at;
}

test("usuário novo (modelo de primeiro cadastro): GET não gasta o token; o POST faz o login (L7, M1/M5)", async ({ page, request, browser, baseURL }) => {
  const link = await latestLink(request, email, await requestLink(page));
  expect(link).toMatch(new RegExp(`^${baseURL}/auth/confirmar\\?token_hash=[\\w-]+&type=email$`));

  // Pré-visualização do e-mail / antivírus: vários GETs, sem seguir para o login.
  for (let i = 0; i < 2; i++) {
    const res = await request.get(link, { maxRedirects: 0 });
    expect(res.status()).toBe(200);
    expect(res.headers()["set-cookie"] ?? "").not.toContain("sb-app-auth-token");
  }

  // Outro navegador (o app de e-mail do celular): o link continua valendo e o clique entra.
  const other = await browser.newContext();
  const tab = await other.newPage();
  await tab.goto(link);
  await tab.getByRole("button", { name: "Entrar" }).click();
  // Login vai para /inicio, que manda quem ainda não tem perfil para o formulário (#12).
  await expect(tab).toHaveURL(`${baseURL}/perfil`);
  // Conta em uso, mascarada, no cabeçalho e na página; o e-mail inteiro nunca.
  await expect(tab.getByTestId("connected-as")).toHaveText("Conectado como pe***@e***.org");
  await expect(tab.locator("body")).not.toContainText(email);

  // O mesmo link não serve de novo.
  const third = await (await browser.newContext()).newPage();
  await third.goto(link);
  await third.getByRole("button", { name: "Entrar" }).click();
  await expect(third).toHaveURL(/\/entrar\?erro=/);
  await other.close();
});

test("usuário existente (modelo de link mágico) entra pelo botão", async ({ page, request, browser, baseURL }) => {
  // O Auth exige 60 s entre dois e-mails para o mesmo endereço (max_frequency).
  test.setTimeout(120_000);
  await page.waitForTimeout(61_000);
  const link = await latestLink(request, email, await requestLink(page));
  const tab = await (await browser.newContext()).newPage();
  await tab.goto(link);
  await tab.getByRole("button", { name: "Entrar" }).click();
  // Login vai para /inicio, que manda quem ainda não tem perfil para o formulário (#12).
  await expect(tab).toHaveURL(`${baseURL}/perfil`);
  await expect(tab.getByTestId("connected-as")).toContainText("pe***@e***.org");
});
