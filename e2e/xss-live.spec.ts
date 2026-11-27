import { expect, test, type Browser, type Page } from "@playwright/test";
import { acceptTermIfAsked } from "./accept-term";

// XSS em campos de texto (#156, parte 1): códigos (`<img onerror>`, `<svg onload>`, `<script>`)
// digitados nos campos em que o texto de uma pessoa aparece na tela de OUTRA: nome na fila da
// coordenação, título do portfólio, equipes de antes da plataforma e nome/área de habilidade
// criada pela coordenação (que todo membro vê ao marcar as suas). O texto tem de aparecer como
// texto e nada pode rodar: nenhum diálogo e nenhuma marca `window.__xss`. O resto do app segue a
// mesma regra (React escapa; tests/eslint-xss.test.ts proíbe HTML cru no código).
// Para rodar (stack local de pé):
//   E2E_LIVE_SUPABASE_URL=<API_URL> E2E_LIVE_ANON_KEY=<ANON_KEY> E2E_LIVE_SERVICE_KEY=<SERVICE_ROLE_KEY> \
//   npm run test:e2e -- e2e/xss-live.spec.ts
// A chave de serviço do stack LOCAL fica só neste processo (cria as pessoas de teste); o app nunca
// a recebe (R6).
const API = process.env.E2E_LIVE_SUPABASE_URL;
const SERVICE_KEY = process.env.E2E_LIVE_SERVICE_KEY ?? process.env.E2E_LIVE_SERVICE_ROLE_KEY;
const LIVE = Boolean(API && process.env.E2E_LIVE_ANON_KEY && SERVICE_KEY);

const PAYLOAD = {
  img: `<img src=x onerror="window.__xss=1">`,
  svg: `<svg onload=window.__xss=1>`,
  script: `<script>window.__xss=1</script>`,
};
const SAO_PAULO = 3550308;

type Session = { readonly page: Page; readonly dialogs: string[] };

test.describe("XSS com o Supabase local", () => {
  test.skip(!LIVE, "precisa do Supabase local e das chaves locais (ver o topo do arquivo)");
  test.describe.configure({ mode: "serial" });

  const run = Date.now();
  const admin = (path: string, init: RequestInit = {}) =>
    fetch(`${API}${path}`, {
      ...init,
      headers: { apikey: SERVICE_KEY!, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json", ...init.headers },
    });

  /** Entra pelo link mágico num navegador novo, anotando qualquer diálogo que abrir. */
  async function openSession(browser: Browser, email: string): Promise<Session & { id: string }> {
    const link = await (await admin("/auth/v1/admin/generate_link", { method: "POST", body: JSON.stringify({ type: "magiclink", email }) })).json();
    const page = await (await browser.newContext()).newPage();
    const dialogs: string[] = [];
    page.on("dialog", (dialog) => {
      dialogs.push(dialog.message());
      void dialog.dismiss();
    });
    await page.goto(`/auth/confirmar?token_hash=${link.hashed_token}&type=${link.verification_type}`);
    await page.getByRole("button", { name: "Entrar" }).click();
    await page.waitForURL((url) => !url.pathname.startsWith("/auth/"));
    return { page, dialogs, id: link.id };
  }

  /** Pessoa ativa criada pela chave de serviço; com `root`, também gestora da raiz. */
  async function activeMember(tag: string, root: boolean): Promise<string> {
    const email = `xss.${tag}.${run}@exemplo.org`;
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
    return email;
  }

  /** O texto aparece como texto e nada rodou: nenhum diálogo e nenhuma marca no `window`. */
  async function expectInert({ page, dialogs }: Session, ...texts: string[]) {
    await page.waitForLoadState("load");
    for (const text of texts) await expect(page.getByText(text, { exact: false }).first()).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { __xss?: unknown }).__xss)).toBeUndefined();
    expect(dialogs).toEqual([]);
  }

  test("nome com código, na fila de espera, não roda na tela da coordenação", async ({ browser, baseURL }) => {
    test.setTimeout(90_000);
    const name = `Pessoa ${PAYLOAD.img}`;
    const person = await openSession(browser, `xss.fila.${run}@exemplo.org`);
    await acceptTermIfAsked(person.page);
    await expect(person.page).toHaveURL(`${baseURL}/perfil`);
    await person.page.getByLabel("Seu nome").fill(name);
    await person.page.getByLabel("Seu WhatsApp, com DDD").fill(`11 9${String(run).slice(-8)}`);
    // Formulário novo da main (#cidades/distritos): estado → cidade → distrito (São Paulo tem vários).
    await person.page.getByLabel("Seu estado").selectOption({ label: "São Paulo" });
    await person.page.getByLabel("Sua cidade", { exact: true }).selectOption({ label: "São Paulo" });
    await person.page.getByLabel("Seu distrito").selectOption({ label: "Sé" });
    await person.page.getByRole("button", { name: "Salvar meus dados" }).click();
    await expect(person.page).toHaveURL(`${baseURL}/espera`);

    const manager = await openSession(browser, await activeMember("raiz", true));
    await manager.page.goto("/coordenacao/espera");
    const entry = manager.page.getByTestId("waitlist-entry").filter({ hasText: name });
    for (let i = 0; i < 50 && (await entry.count()) === 0; i++) await manager.page.getByRole("link", { name: "Ver mais pessoas" }).click();
    await expect(entry).toHaveCount(1);
    await expectInert(manager, name);
  });

  test("portfólio e equipes de antes da plataforma com código não rodam", async ({ browser, baseURL }) => {
    const member = await openSession(browser, await activeMember("membro", false));

    await member.page.goto("/perfil/portfolio");
    await member.page.locator("#url").fill("https://example.org/trabalho");
    await member.page.locator("#title").fill(PAYLOAD.svg);
    await member.page.getByRole("button", { name: "Adicionar ao portfólio" }).click();
    await expect(member.page).toHaveURL(`${baseURL}/perfil/portfolio?ok=added`);
    await expectInert(member, PAYLOAD.svg);

    await member.page.goto("/perfil/equipes-anteriores");
    await member.page.locator("#teamName").fill(PAYLOAD.img);
    await member.page.locator("#period").fill(PAYLOAD.svg);
    await member.page.getByRole("button", { name: "Adicionar equipe" }).click();
    await expect(member.page).toHaveURL(`${baseURL}/perfil/equipes-anteriores?ok=added`);
    await expectInert(member, PAYLOAD.img, PAYLOAD.svg);
  });

  test("habilidade com código criada pela coordenação não roda na tela de quem marca", async ({ browser, baseURL }) => {
    const skillName = `Teste ${run} ${PAYLOAD.script}`;
    const manager = await openSession(browser, await activeMember("catalogo", true));
    await manager.page.goto("/coordenacao/habilidades");
    const add = manager.page.locator("form").filter({ has: manager.page.locator('input[name="skillId"][value=""]') });
    await add.locator('input[name="name"]').fill(skillName);
    await add.locator('input[name="category"]').fill(`Área ${PAYLOAD.img}`);
    await add.getByRole("button").click();
    await expect(manager.page).toHaveURL(`${baseURL}/coordenacao/habilidades?ok=1`);

    try {
      const member = await openSession(browser, await activeMember("marca", false));
      await member.page.goto("/perfil/habilidades");
      await member.page.getByLabel(/Procurar habilidade/).fill(String(run));
      await expectInert(member, skillName, `Área ${PAYLOAD.img}`);
    } finally {
      // A habilidade de teste não fica no catálogo.
      await admin(`/rest/v1/skills?name=eq.${encodeURIComponent(skillName)}`, { method: "DELETE" });
    }
  });
});
