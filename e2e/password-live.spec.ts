import { expect as baseExpect, test, type APIRequestContext, type Browser, type Page } from "@playwright/test";
import { giveHouse } from "./give-house";

// O login por senha passa pelo Auth (bcrypt) e pela conferência do Turnstile: mais folga que os 5 s padrão.
const expect = baseExpect.configure({ timeout: 20_000 });

// Senha opcional (ADR 0018), contra o Supabase local com o Mailpit. No CI roda no job "E2E com
// banco". Para rodar localmente, veja o topo de e2e/navigation-live.spec.ts (mais E2E_MAILPIT_URL).
// A chave de serviço do stack LOCAL fica só neste processo de teste; o app e o navegador não a recebem (R6).
const API = process.env.E2E_LIVE_SUPABASE_URL;
const SERVICE_KEY = process.env.E2E_LIVE_SERVICE_KEY ?? process.env.E2E_LIVE_SERVICE_ROLE_KEY;
const MAILPIT = process.env.E2E_MAILPIT_URL;
const LIVE = Boolean(API && process.env.E2E_LIVE_ANON_KEY && SERVICE_KEY && MAILPIT);

test.describe("senha opcional com o Supabase local", () => {
  test.skip(!LIVE, "precisa do Supabase local, das chaves locais e do Mailpit");
  test.describe.configure({ mode: "serial" });

  const run = Date.now();
  const SAO_PAULO = 3550308;
  const email = `senha.${run}@exemplo.org`;
  // Frases fictícias de teste (12+ caracteres, fora da lista de comuns).
  const first = ["cavalo","grande","azul"].join(" ");
  const second = ["estrela","do","mar","azul"].join(" ");

  const admin = (path: string, init: RequestInit = {}) =>
    fetch(`${API}${path}`, {
      ...init,
      headers: { apikey: SERVICE_KEY!, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json", ...init.headers },
    });

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

  /** Pessoa ativa, com casa e termo; entra pelo link mágico numa aba nova (sem passar pelo e-mail). */
  async function activeSignedIn(browser: Browser): Promise<Page> {
    const created = await (await admin("/auth/v1/admin/users", { method: "POST", body: JSON.stringify({ email, email_confirm: true }) })).json();
    const profile = await admin("/rest/v1/profiles", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        id: created.id,
        display_name_enc: "v1.AAAAAAAAAAAAAAAA.BBBBBBBBBBBBBBBBBBBBBB",
        municipality_code: SAO_PAULO,
        consent_version: "v1",
        access_status: "active",
        status: "active",
      }),
    });
    expect(profile.status).toBe(201);
    await giveHouse(admin, created.id);
    const consent = await admin("/rest/v1/consent_acceptances", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ user_id: created.id, version: "v1" }) });
    expect(consent.status).toBe(201);
    const link = await (await admin("/auth/v1/admin/generate_link", { method: "POST", body: JSON.stringify({ type: "magiclink", email }) })).json();
    const page = await (await browser.newContext()).newPage();
    await page.goto(`/auth/confirmar?token_hash=${link.hashed_token}&type=${link.verification_type}`);
    await page.getByRole("button", { name: "Entrar" }).click();
    await page.waitForURL((url) => !url.pathname.startsWith("/auth/"));
    return page;
  }

  async function waitForHuman(page: Page): Promise<void> {
    // Turnstile (#116) com a chave de teste que sempre passa: sem o token, nada é enviado.
    await expect(page.locator('input[name="cf-turnstile-response"]')).not.toHaveValue("", { timeout: 20_000 });
  }

  async function signInWithPassword(page: Page, address: string, password: string): Promise<void> {
    await page.goto("/entrar");
    await page.getByLabel("Seu e-mail").fill(address);
    await page.getByLabel(/Sua senha/).fill(password);
    await waitForHuman(page);
    await clickButton(page, "Entrar com senha");
  }

  /** O widget do Turnstile muda a altura da página ao carregar: rola até o botão antes de clicar. */
  async function clickButton(page: Page, name: string): Promise<void> {
    const button = page.getByRole("button", { name });
    await button.scrollIntoViewIfNeeded();
    await button.click();
  }

  test("define a senha, sai e entra com ela (sem e-mail)", async ({ browser, baseURL }) => {
    const page = await activeSignedIn(browser);
    await expect(page).toHaveURL(`${baseURL}/inicio`);
    await page.getByRole("link", { name: "Senha para entrar" }).click();
    await expect(page).toHaveURL(`${baseURL}/senha`);

    // Senha curta é recusada com a mensagem, sem chamar o Auth.
    await page.getByLabel("Nova senha", { exact: true }).fill("curta");
    await page.getByLabel("Repita a nova senha").fill("curta");
    await page.getByRole("button", { name: "Salvar senha" }).click();
    await expect(page.getByRole("main").getByRole("alert")).toHaveText(/pelo menos 12/);

    // O medidor acompanha o que é digitado.
    await page.getByLabel("Nova senha", { exact: true }).fill(first);
    await expect(page.getByRole("status").filter({ hasText: "Força da senha" })).toContainText("Forte");
    await page.getByLabel("Repita a nova senha").fill(first);
    await page.getByRole("button", { name: "Salvar senha" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Senha salva" })).toBeVisible();
    // A senha nunca aparece na URL.
    expect(page.url()).not.toContain(encodeURIComponent(first));

    await page.getByRole("button", { name: "Sair" }).click();
    await expect(page).toHaveURL(/\/entrar\?saiu=1/);

    await signInWithPassword(page, email, first);
    await expect(page).toHaveURL(`${baseURL}/inicio`);
    await expect(page.getByTestId("connected-as")).toContainText("se***@e***.org");
  });

  test("senha errada e e-mail sem conta dão a mesma mensagem genérica", async ({ page }) => {
    await signInWithPassword(page, email, "senha errada de proposito");
    const wrong = await page.getByRole("main").getByRole("alert").innerText();
    expect(wrong).toMatch(/E-mail ou senha não conferem/);

    await signInWithPassword(page, `ninguem.${run}@exemplo.org`, "senha errada de proposito");
    await expect(page.getByRole("main").getByRole("alert")).toHaveText(wrong);
    // Nada da senha digitada na URL.
    expect(page.url()).not.toContain("proposito");
  });

  test("quem não está autorizado entra com a senha, mas o acesso segue pelo portão (nunca chega ao /inicio)", async ({ page }) => {
    const outsider = `fora.${run}@exemplo.org`;
    const made = await admin("/auth/v1/admin/users", { method: "POST", body: JSON.stringify({ email: outsider, password: first, email_confirm: true }) });
    expect(made.status).toBeLessThan(300);
    await signInWithPassword(page, outsider, first);
    // Como no link por e-mail: sem perfil, vai ao termo (depois, à espera); a senha não abre atalho.
    await expect(page).toHaveURL(/\/(termo|espera|perfil)$/);
    await page.goto("/inicio");
    await expect(page).toHaveURL(/\/(termo|espera|perfil)$/);
    await expect(page.getByTestId("home-greeting")).toHaveCount(0);
  });

  test("esqueci a senha: o link do e-mail leva a /senha e a nova senha entra", async ({ page, request, browser, baseURL }) => {
    await page.goto("/entrar");
    await page.getByLabel("Seu e-mail").fill(email);
    await waitForHuman(page);
    const at = Date.now() - 1000;
    await clickButton(page, "Esqueci a senha");
    await expect(page.getByRole("main").getByRole("status")).toHaveText(/Se este e-mail tiver conta/);

    const link = await latestLink(request, email, at);
    expect(link).toMatch(new RegExp(`^${baseURL}/auth/confirmar\\?token_hash=[\\w-]+&type=recovery$`));
    const tab = await (await browser.newContext()).newPage();
    await tab.goto(link);
    await tab.getByRole("button", { name: "Entrar" }).click();
    await expect(tab).toHaveURL(`${baseURL}/senha`);

    await tab.getByLabel("Nova senha", { exact: true }).fill(second);
    await tab.getByLabel("Repita a nova senha").fill(second);
    await tab.getByRole("button", { name: "Salvar senha" }).click();
    await expect(tab.getByRole("status").filter({ hasText: "Senha salva" })).toBeVisible();
    await tab.getByRole("button", { name: "Sair" }).click();

    await signInWithPassword(tab, email, second);
    await expect(tab).toHaveURL(`${baseURL}/inicio`);
    // A senha antiga já não vale.
    await tab.getByRole("button", { name: "Sair" }).click();
    await signInWithPassword(tab, email, first);
    await expect(tab.getByRole("main").getByRole("alert")).toHaveText(/E-mail ou senha não conferem/);
  });

  test("remover a senha: a senha deixa de entrar e o link continua valendo", async ({ page, baseURL }) => {
    await signInWithPassword(page, email, second);
    await expect(page).toHaveURL(`${baseURL}/inicio`);
    await page.goto("/senha");
    await page.getByRole("button", { name: "Remover minha senha" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Senha removida" })).toBeVisible();
    await page.getByRole("button", { name: "Sair" }).click();
    await signInWithPassword(page, email, second);
    await expect(page.getByRole("main").getByRole("alert")).toHaveText(/E-mail ou senha não conferem/);
  });
});
