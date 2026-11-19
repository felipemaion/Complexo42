import { expect, test, type Browser, type Page } from "@playwright/test";

// Telas da coordenação (#26, ADR 0008 §1): lista de autorizados e fila de espera. Sem Supabase
// (o CI): só a proteção das rotas. Com o Supabase local, o fluxo real: pessoas se cadastram e
// caem na espera; o gestor da raiz envia a lista e quem estava nela é liberado; libera e
// bloqueia à mão, com confirmação; quem não coordena não vê nem abre as telas; e, com o papel
// revogado no meio do caminho, o BANCO recusa (a tela não é a segurança, R15). Para rodar
// (stack local de pé, `site_url` do supabase/config.toml apontando para a porta do E2E):
//   E2E_LIVE_SUPABASE_URL=<API_URL> E2E_LIVE_ANON_KEY=<ANON_KEY> \
//   E2E_LIVE_SERVICE_KEY=<SERVICE_ROLE_KEY do `supabase status`> npm run test:e2e -- e2e/coordination-live.spec.ts
// A chave de serviço do stack LOCAL fica só neste processo de teste (cria o gestor e confere o
// banco); o app e o navegador nunca a recebem (R6).
const API = process.env.E2E_LIVE_SUPABASE_URL;
const SERVICE_KEY = process.env.E2E_LIVE_SERVICE_KEY ?? process.env.E2E_LIVE_SERVICE_ROLE_KEY;
const LIVE = Boolean(API && process.env.E2E_LIVE_ANON_KEY && SERVICE_KEY);

test("sem sessão, as telas da coordenação mandam para o login", async ({ page }) => {
  for (const path of ["/coordenacao", "/coordenacao/autorizados", "/coordenacao/espera"]) {
    await page.goto(path);
    await expect(page).toHaveURL(new RegExp(`/entrar\\?next=${encodeURIComponent(path)}$`));
  }
});

test.describe("coordenação com o Supabase local", () => {
  test.skip(!LIVE, "precisa do Supabase local e das chaves locais (ver o topo do arquivo)");
  test.describe.configure({ mode: "serial" });

  const run = Date.now();
  let phone = 0;
  const SAO_PAULO = 3550308;

  const admin = (path: string, init: RequestInit = {}) =>
    fetch(`${API}${path}`, {
      ...init,
      headers: { apikey: SERVICE_KEY!, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json", ...init.headers },
    });

  /** Entra pelo link mágico (gerado pela chave de serviço) num navegador novo. */
  async function openSession(browser: Browser, email: string): Promise<{ page: Page; id: string }> {
    const link = await (await admin("/auth/v1/admin/generate_link", { method: "POST", body: JSON.stringify({ type: "magiclink", email }) })).json();
    const page = await (await browser.newContext()).newPage();
    await page.goto(`/auth/confirmar?token_hash=${link.hashed_token}&type=${link.verification_type}`);
    await page.getByRole("button", { name: "Entrar" }).click();
    // Espera o login terminar (cookie gravado) antes de navegar para outra tela.
    await page.waitForURL((url) => !url.pathname.startsWith("/auth/"));
    return { page, id: link.id };
  }

  /** Pessoa nova que se cadastra pelo formulário e cai na espera (e-mail fora da lista). */
  async function waitlisted(browser: Browser, baseURL: string, tag: string) {
    const person = { email: `espera.${tag}.${run}@exemplo.org`, name: `Pessoa Espera ${tag.toUpperCase()} ${run}` };
    const { page, id } = await openSession(browser, person.email);
    await expect(page).toHaveURL(`${baseURL}/perfil`);
    await page.getByLabel("Seu nome").fill(person.name);
    await page.getByLabel("Seu WhatsApp, com DDD").fill(`11 9${String(run + ++phone).slice(-8)}`);
    await page.getByLabel("Sua cidade").selectOption({ label: "São Paulo" });
    await page.getByRole("button", { name: "Salvar meus dados" }).click();
    await expect(page).toHaveURL(`${baseURL}/espera`);
    expect(await accessStatus(id)).toBe("waitlisted");
    return { ...person, page, id };
  }

  async function accessStatus(id: string): Promise<string> {
    const [row] = await (await admin(`/rest/v1/profiles?id=eq.${id}&select=access_status`)).json();
    return row.access_status;
  }

  /** Pessoa ativa criada pela chave de serviço; com `root`, também gestora da raiz. */
  async function activeMember(tag: string, root: boolean): Promise<{ email: string; roleId?: string }> {
    const email = `coord.${tag}.${run}@exemplo.org`;
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
    if (!root) return { email };
    const [unit] = await (await admin("/rest/v1/units?parent_id=is.null&select=id")).json();
    const [role] = await (
      await admin("/rest/v1/role_assignments?select=id", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({ profile_id: user.id, role: "manager", unit_id: unit.id }),
      })
    ).json();
    return { email, roleId: role.id };
  }

  /** Vai até a página da fila em que a pessoa aparece (a fila é paginada, mais antigos primeiro). */
  async function findInQueue(page: Page, name: string) {
    await page.goto("/coordenacao/espera");
    const entry = page.getByTestId("waitlist-entry").filter({ hasText: name });
    for (let i = 0; i < 50 && (await entry.count()) === 0; i++) await page.getByRole("link", { name: "Ver mais pessoas" }).click();
    await expect(entry).toHaveCount(1);
    return entry;
  }

  test("quem não coordena não vê o atalho e não abre as telas", async ({ browser, baseURL }) => {
    const member = await activeMember("membro", false);
    const { page } = await openSession(browser, member.email);
    await expect(page).toHaveURL(`${baseURL}/inicio`);
    await expect(page.getByRole("link", { name: "Coordenação" })).toHaveCount(0);
    for (const path of ["/coordenacao", "/coordenacao/autorizados", "/coordenacao/espera"]) {
      await page.goto(path);
      await expect(page).toHaveURL(`${baseURL}/inicio`);
    }
  });

  test("o gestor da raiz envia a lista e quem estava na espera é liberado", async ({ browser, baseURL }) => {
    const person = await waitlisted(browser, baseURL!, "a");
    const manager = await activeMember("raiz", true);
    const { page } = await openSession(browser, manager.email);
    await expect(page).toHaveURL(`${baseURL}/inicio`);
    await page.getByRole("link", { name: "Coordenação" }).click();
    await page.getByRole("link", { name: "Enviar lista de pessoas autorizadas" }).click();
    await expect(page).toHaveURL(`${baseURL}/coordenacao/autorizados`);

    const csv = `Nome;E-mail\nPessoa A;${person.email.toUpperCase()}\nSem e-mail;fulano@\nOutra;outra.${run}@exemplo.org\n`;
    await page.getByLabel("Arquivo com os e-mails (.csv ou .txt)").setInputFiles({ name: "lista.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
    await page.getByRole("button", { name: "Enviar lista" }).click();
    await expect(page.getByTestId("allowlist-received")).toHaveText("E-mails recebidos: 2");
    await expect(page.getByTestId("allowlist-promoted")).toHaveText("Pessoas que estavam esperando e foram liberadas agora: 1");
    await expect(page.getByTestId("allowlist-invalid-lines")).toContainText(": 3");
    // A tela mostra só contagens e números de linha, nunca o conteúdo do arquivo.
    await expect(page.locator("body")).not.toContainText("@exemplo.org");
    await expect(page.locator("body")).not.toContainText("fulano");

    expect(await accessStatus(person.id)).toBe("active");
    // A pessoa liberada entra sem passar pela espera.
    await person.page.goto("/inicio");
    await expect(person.page).toHaveURL(`${baseURL}/inicio`);
  });

  test("liberar e bloquear à mão, sempre com confirmação", async ({ browser, baseURL }) => {
    const toApprove = await waitlisted(browser, baseURL!, "b");
    const toBlock = await waitlisted(browser, baseURL!, "c");
    const manager = await activeMember("fila", true);
    const { page } = await openSession(browser, manager.email);

    let entry = await findInQueue(page, toApprove.name);
    await expect(entry).toContainText("São Paulo (SP)");
    await entry.getByRole("link", { name: `Liberar: ${toApprove.name}` }).click();
    // Só a confirmação decide; até aqui nada mudou.
    await expect(entry.getByRole("alert")).toHaveText(`Liberar o acesso de ${toApprove.name}? A pessoa vai poder entrar e usar a plataforma.`);
    expect(await accessStatus(toApprove.id)).toBe("waitlisted");
    await entry.getByRole("button", { name: "Sim, liberar" }).click();
    await expect(page.getByRole("status")).toHaveText("Pronto! O acesso foi liberado.");
    expect(await accessStatus(toApprove.id)).toBe("active");

    entry = await findInQueue(page, toBlock.name);
    await entry.getByRole("link", { name: `Bloquear: ${toBlock.name}` }).click();
    await entry.getByRole("link", { name: "Não, voltar" }).click();
    expect(await accessStatus(toBlock.id)).toBe("waitlisted");
    await entry.getByRole("link", { name: `Bloquear: ${toBlock.name}` }).click();
    await entry.getByRole("button", { name: "Sim, bloquear" }).click();
    await expect(page.getByRole("status")).toHaveText("Pronto! O acesso foi bloqueado.");
    expect(await accessStatus(toBlock.id)).toBe("blocked");

    // A fila nunca mostra e-mail; as duas pessoas decididas saíram dela.
    await page.goto("/coordenacao/espera");
    await expect(page.locator("body")).not.toContainText("@exemplo.org");
    await expect(page.getByTestId("waitlist-entry").filter({ hasText: toApprove.name })).toHaveCount(0);
  });

  test("com o papel revogado no meio do caminho, o banco recusa (a tela não é a segurança)", async ({ browser, baseURL }) => {
    const person = await waitlisted(browser, baseURL!, "d");
    const manager = await activeMember("revogado", true);
    const { page } = await openSession(browser, manager.email);
    const entry = await findInQueue(page, person.name);
    await entry.getByRole("link", { name: `Liberar: ${person.name}` }).click();
    const upload = await page.context().newPage();
    await upload.goto("/coordenacao/autorizados");
    await upload.getByLabel("Arquivo com os e-mails (.csv ou .txt)").setInputFiles({ name: "lista.txt", mimeType: "text/plain", buffer: Buffer.from(person.email) });

    // As telas já estão abertas; o papel acaba agora.
    const revoked = await admin(`/rest/v1/role_assignments?id=eq.${manager.roleId}`, {
      method: "PATCH",
      body: JSON.stringify({ revoked_at: new Date().toISOString() }),
    });
    expect(revoked.ok).toBe(true);

    // Sem o papel, a decisão não passa no banco e a pessoa volta para o início, sem erro.
    await entry.getByRole("button", { name: "Sim, liberar" }).click();
    await expect(page).toHaveURL(`${baseURL}/inicio`);
    await upload.getByRole("button", { name: "Enviar lista" }).click();
    await expect(upload.getByRole("main").getByRole("alert")).toHaveText("Só a coordenação geral pode enviar a lista de pessoas autorizadas.");
    expect(await accessStatus(person.id)).toBe("waitlisted");
  });
});
