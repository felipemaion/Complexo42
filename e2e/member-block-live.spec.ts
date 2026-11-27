import { expect, test, type Browser, type Page } from "@playwright/test";
import { giveHouse } from "./give-house";

// Bloquear e desbloquear quem já entrou (#26, ADR 0008 §1), com o navegador da coordenação SEM
// JavaScript: pedido, confirmação ("Não, voltar" não muda nada), bloqueio com efeito imediato
// (a sessão aberta da pessoa cai), resposta neutra para e-mail sem conta e para si mesmo, e o
// desbloqueio, que devolve a pessoa à fila de espera. Sem Supabase (o CI sem banco): só a
// proteção da rota. Para rodar com o banco, ver o topo de e2e/coordination-live.spec.ts.
const API = process.env.E2E_LIVE_SUPABASE_URL;
const SERVICE_KEY = process.env.E2E_LIVE_SERVICE_KEY ?? process.env.E2E_LIVE_SERVICE_ROLE_KEY;
const LIVE = Boolean(API && process.env.E2E_LIVE_ANON_KEY && SERVICE_KEY);

test("sem sessão, a tela de bloqueio manda para o login", async ({ page }) => {
  await page.goto("/coordenacao/bloqueio");
  await expect(page).toHaveURL(new RegExp(`/entrar\\?next=${encodeURIComponent("/coordenacao/bloqueio")}$`));
});

test.describe("bloqueio com o Supabase local", () => {
  test.skip(!LIVE, "precisa do Supabase local e das chaves locais (ver e2e/coordination-live.spec.ts)");
  test.describe.configure({ mode: "serial" });

  const run = Date.now();
  const SAO_PAULO = 3550308;
  const BLOCK = "Bloquear o acesso";
  const UNBLOCK = "Desbloquear (volta para a lista de espera)";

  const admin = (path: string, init: RequestInit = {}) =>
    fetch(`${API}${path}`, {
      ...init,
      headers: { apikey: SERVICE_KEY!, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json", ...init.headers },
    });

  /**
   * Entra pelo link mágico (gerado pela chave de serviço) num navegador novo. Sem JavaScript, o
   * login acontece num contexto com JS e só a sessão (cookies) passa para o contexto sem JS: o
   * que se testa sem JS é a tela de bloqueio, não a de login.
   */
  async function openSession(browser: Browser, email: string, javaScriptEnabled = true): Promise<Page> {
    const link = await (await admin("/auth/v1/admin/generate_link", { method: "POST", body: JSON.stringify({ type: "magiclink", email }) })).json();
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`/auth/confirmar?token_hash=${link.hashed_token}&type=${link.verification_type}`);
    await page.getByRole("button", { name: "Entrar" }).click();
    await page.waitForURL((url) => !url.pathname.startsWith("/auth/"));
    if (javaScriptEnabled) return page;
    const storageState = await context.storageState();
    await context.close();
    return (await browser.newContext({ javaScriptEnabled: false, storageState })).newPage();
  }

  async function accessStatus(id: string): Promise<string> {
    const [row] = await (await admin(`/rest/v1/profiles?id=eq.${id}&select=access_status`)).json();
    return row.access_status;
  }

  /** Pessoa ativa criada direto pela chave de serviço, já com o aceite do termo v1 (#11). */
  async function activeMember(tag: string, root: boolean): Promise<{ email: string; id: string }> {
    const email = `bloqueio.${tag}.${run}@exemplo.org`;
    const user = await (await admin("/auth/v1/admin/users", { method: "POST", body: JSON.stringify({ email, email_confirm: true }) })).json();
    const profile = await admin("/rest/v1/profiles", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        id: user.id,
        display_name_enc: "v1.AAAAAAAAAAAAAAAA.BBBBBBBBBBBBBBBBBBBBBB",
        municipality_code: SAO_PAULO,
        consent_version: "v1",
        access_status: "active",
        status: "active",
      }),
    });
    expect(profile.status).toBe(201);
    await giveHouse(admin, user.id);
    const consent = await admin("/rest/v1/consent_acceptances", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ user_id: user.id, version: "v1" }),
    });
    expect(consent.status).toBe(201);
    if (root) {
      const [unit] = await (await admin("/rest/v1/units?parent_id=is.null&select=id")).json();
      const role = await admin("/rest/v1/role_assignments", {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ profile_id: user.id, role: "manager", unit_id: unit.id }),
      });
      expect(role.status).toBe(201);
    }
    return { email, id: user.id };
  }

  /** Preenche o pedido e vai até a confirmação. */
  async function request(page: Page, email: string, action: string, reason?: string) {
    await page.getByLabel("E-mail de login da pessoa").fill(email);
    await page.getByLabel(action).check();
    if (reason) await page.getByLabel("Motivo do bloqueio (opcional)").selectOption({ label: reason });
    await page.getByRole("button", { name: "Continuar" }).click();
  }

  test("bloquear quem está ativo, sem JavaScript, com confirmação e efeito imediato", async ({ browser, baseURL }) => {
    const person = await activeMember("alvo", false);
    const manager = await activeMember("gestor", true);
    const personPage = await openSession(browser, person.email);
    await expect(personPage).toHaveURL(`${baseURL}/inicio`);

    const page = await openSession(browser, manager.email, false);
    await page.goto("/coordenacao");
    await page.getByRole("link", { name: "Bloquear ou desbloquear acesso" }).click();
    await expect(page).toHaveURL(`${baseURL}/coordenacao/bloqueio`);

    // "Não, voltar" não muda nada.
    await request(page, person.email.toUpperCase(), BLOCK);
    await expect(page.getByRole("alert")).toContainText(`Bloquear o acesso de ${person.email}?`);
    await page.getByRole("button", { name: "Não, voltar" }).click();
    await expect(page.getByRole("button", { name: "Continuar" })).toBeVisible();
    expect(await accessStatus(person.id)).toBe("active");

    await request(page, person.email, BLOCK, "Cadastro com o e-mail de outra pessoa");
    await expect(page.getByText("Motivo: Cadastro com o e-mail de outra pessoa")).toBeVisible();
    await page.getByRole("button", { name: "Sim, bloquear" }).click();
    const done = "Pedido concluído. Se o e-mail é de alguém ativo na sua área, o acesso foi bloqueado agora.";
    await expect(page.getByTestId("member-block-done")).toHaveText(done);
    expect(await accessStatus(person.id)).toBe("blocked");

    // Efeito imediato: a sessão que já estava aberta cai na próxima página.
    await personPage.goto("/inicio");
    await expect(personPage).not.toHaveURL(`${baseURL}/inicio`);

    // Resposta neutra: e-mail sem conta e o próprio e-mail dão o mesmo texto, sem mudar nada.
    for (const email of [`ninguem.${run}@exemplo.org`, manager.email]) {
      await request(page, email, BLOCK);
      await page.getByRole("button", { name: "Sim, bloquear" }).click();
      await expect(page.getByTestId("member-block-done")).toHaveText(done);
    }
    expect(await accessStatus(manager.id)).toBe("active");

    // Desbloquear devolve a pessoa à fila de espera.
    await request(page, person.email, UNBLOCK);
    await expect(page.getByRole("alert")).toContainText(`Desbloquear ${person.email}?`);
    await page.getByRole("button", { name: "Sim, desbloquear" }).click();
    await expect(page.getByTestId("member-block-done")).toContainText("voltou para a lista de espera");
    expect(await accessStatus(person.id)).toBe("waitlisted");
  });

  test("quem não coordena não abre a tela de bloqueio", async ({ browser, baseURL }) => {
    const member = await activeMember("membro", false);
    const page = await openSession(browser, member.email);
    await page.goto("/coordenacao/bloqueio");
    await expect(page).toHaveURL(`${baseURL}/inicio`);
  });
});
