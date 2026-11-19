import { expect, test, type Browser, type Page } from "@playwright/test";

// "Excluir minha conta" (#18). Sem Supabase (o CI): a página exige sessão e a despedida é
// pública. Com o Supabase local, o fluxo real: duas pessoas se cadastram, uma exclui a conta
// pela página inicial e some do Auth e do banco; a outra continua; quem está na espera também
// exclui. Para rodar (stack local de pé, `site_url` do supabase/config.toml apontando para a
// porta do E2E):
//   E2E_LIVE_SUPABASE_URL=<API_URL> E2E_LIVE_ANON_KEY=<ANON_KEY> \
//   E2E_LIVE_SERVICE_KEY=<SERVICE_ROLE_KEY do `supabase status`> npm run test:e2e -- e2e/delete-account.spec.ts
// A chave de serviço do stack LOCAL fica só neste processo de teste (cria o link de login, libera
// as pessoas de teste e confere o que sobrou); o app nunca a recebe (R6): ele exclui pela função
// `delete_own_account`, com o JWT da própria pessoa.
const API = process.env.E2E_LIVE_SUPABASE_URL;
const SERVICE_KEY = process.env.E2E_LIVE_SERVICE_KEY;
const LIVE = Boolean(API && SERVICE_KEY);

test("sem sessão, a página da exclusão manda para o login", async ({ page, baseURL }) => {
  await page.goto("/excluir-conta");
  await expect(page).toHaveURL(`${baseURL}/entrar?next=%2Fexcluir-conta`);
});

test("a despedida é pública e só tem texto fixo", async ({ page }) => {
  await page.goto("/conta-excluida");
  await expect(page.getByRole("heading", { name: "Sua conta foi excluída" })).toBeVisible();
});

test.describe("exclusão com o Supabase local", () => {
  test.skip(!LIVE, "precisa do Supabase local e da chave de serviço local (ver o topo do arquivo)");
  test.describe.configure({ mode: "serial" });

  const run = Date.now();
  const people = {
    a: { email: `excluir.a.${run}@exemplo.org`, name: "Pessoa Exclui A", phone: `11 9${String(run).slice(-8)}`, city: "São Paulo" },
    b: { email: `excluir.b.${run}@exemplo.org`, name: "Pessoa Fica B", phone: `11 9${String(run + 1).slice(-8)}`, city: "Osasco" },
    w: { email: `excluir.w.${run}@exemplo.org`, name: "Pessoa Espera W", phone: `11 9${String(run + 2).slice(-8)}`, city: "Guarulhos" },
  };
  const ids: Partial<Record<keyof typeof people, string>> = {};

  const admin = (path: string, init: RequestInit = {}) =>
    fetch(`${API}${path}`, {
      ...init,
      headers: { apikey: SERVICE_KEY!, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json", ...init.headers },
    });
  const rows = async (path: string) => (await (await admin(`/rest/v1/${path}`)).json()) as unknown[];

  /** Cria a conta, entra pelo link e preenche o perfil (fica na espera); `release` libera. */
  async function signUp(browser: Browser, baseURL: string, who: keyof typeof people, release: boolean): Promise<Page> {
    const person = people[who];
    const link = await (await admin("/auth/v1/admin/generate_link", { method: "POST", body: JSON.stringify({ type: "magiclink", email: person.email }) })).json();
    ids[who] = link.id;
    const page = await (await browser.newContext()).newPage();
    await page.goto(`/auth/confirmar?token_hash=${link.hashed_token}&type=${link.verification_type}`);
    await page.getByRole("button", { name: "Entrar" }).click();
    await expect(page).toHaveURL(`${baseURL}/perfil`);
    await page.getByLabel("Seu nome").fill(person.name);
    await page.getByLabel("Seu WhatsApp, com DDD").fill(person.phone);
    await page.getByLabel("Sua cidade").selectOption({ label: person.city });
    await page.getByRole("button", { name: "Salvar meus dados" }).click();
    await expect(page).toHaveURL(`${baseURL}/espera`);
    if (release) {
      const res = await admin(`/rest/v1/profiles?id=eq.${link.id}`, { method: "PATCH", body: JSON.stringify({ access_status: "active", status: "active" }) });
      expect(res.ok).toBe(true);
    }
    return page;
  }

  async function expectGone(id: string) {
    expect((await admin(`/auth/v1/admin/users/${id}`)).status).toBe(404);
    expect(await rows(`profiles?id=eq.${id}&select=id`)).toEqual([]);
    expect(await rows(`profile_contacts?profile_id=eq.${id}&select=profile_id`)).toEqual([]);
    expect(await rows(`unit_members?profile_id=eq.${id}&select=id`)).toEqual([]);
    expect(await rows(`role_assignments?profile_id=eq.${id}&select=id`)).toEqual([]);
    expect(await rows(`access_waitlist_hmac?profile_id=eq.${id}&select=profile_id`)).toEqual([]);
    // Só o evento, sem dado pessoal.
    expect(await rows(`audit_log?target_id=eq.${id}&event=eq.account_deleted&select=actor_id,item_count,reason`)).toEqual([
      { actor_id: id, item_count: null, reason: null },
    ]);
  }

  test("A exclui a conta pela página inicial; B continua", async ({ browser, baseURL }) => {
    test.setTimeout(120_000);
    const a = await signUp(browser, baseURL!, "a", true);
    const b = await signUp(browser, baseURL!, "b", true);

    await a.goto("/inicio");
    await a.getByRole("link", { name: "Excluir minha conta" }).click();
    await expect(a).toHaveURL(`${baseURL}/excluir-conta`);
    await expect(a.getByTestId("delete-account-warnings")).toContainText("Não dá para desfazer");

    // Palavra errada: nada é apagado.
    await a.getByLabel(/escreva EXCLUIR/).fill("talvez");
    await a.getByRole("button", { name: "Excluir minha conta para sempre" }).click();
    await expect(a).toHaveURL(`${baseURL}/excluir-conta?erro=confirmacao`);
    await expect(a.getByRole("main").getByRole("alert")).toContainText("Escreva EXCLUIR");
    expect(await rows(`profiles?id=eq.${ids.a}&select=id`)).toHaveLength(1);

    await a.getByLabel(/escreva EXCLUIR/).fill("excluir");
    await a.getByRole("button", { name: "Excluir minha conta para sempre" }).click();
    await expect(a).toHaveURL(`${baseURL}/conta-excluida`);
    await expect(a.getByRole("heading", { name: "Sua conta foi excluída" })).toBeVisible();
    await expectGone(ids.a!);

    // A sessão acabou neste aparelho: a área logada manda para o login.
    await a.goto("/inicio");
    await expect(a).toHaveURL(/\/entrar\?next=%2Finicio$/);

    // B não foi afetado.
    expect(await rows(`profiles?id=eq.${ids.b}&select=id`)).toHaveLength(1);
    await b.goto("/inicio");
    await expect(b).toHaveURL(`${baseURL}/inicio`);
  });

  test("quem está na espera também exclui a conta", async ({ browser, baseURL }) => {
    test.setTimeout(60_000);
    const w = await signUp(browser, baseURL!, "w", false);
    await w.getByRole("link", { name: "Excluir minha conta" }).click();
    await expect(w).toHaveURL(`${baseURL}/excluir-conta`);
    await w.getByLabel(/escreva EXCLUIR/).fill("EXCLUIR");
    await w.getByRole("button", { name: "Excluir minha conta para sempre" }).click();
    await expect(w).toHaveURL(`${baseURL}/conta-excluida`);
    await expectGone(ids.w!);
  });
});
