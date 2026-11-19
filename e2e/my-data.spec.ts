import { expect, test, type Browser, type Page } from "@playwright/test";

// "Baixar meus dados" (#20). Sem Supabase (o CI): só a proteção da rota. Com o Supabase local,
// o fluxo real: duas pessoas se cadastram, são liberadas e cada uma baixa o próprio arquivo,
// sem nada da outra. Para rodar (stack local de pé, `site_url` do supabase/config.toml
// apontando para a porta do E2E):
//   E2E_LIVE_SUPABASE_URL=<API_URL> E2E_LIVE_ANON_KEY=<ANON_KEY> \
//   E2E_LIVE_SERVICE_KEY=<SERVICE_ROLE_KEY do `supabase status`> npm run test:e2e -- e2e/my-data.spec.ts
// A chave de serviço do stack LOCAL fica só neste processo de teste (cria o link de login e
// libera as duas pessoas de teste, como faria o gestor); o app nunca a recebe (R6).
const API = process.env.E2E_LIVE_SUPABASE_URL;
const SERVICE_KEY = process.env.E2E_LIVE_SERVICE_KEY;
const LIVE = Boolean(API && SERVICE_KEY);

test("sem sessão, o download manda para o login e não devolve dado nenhum", async ({ request }) => {
  const res = await request.post("/meus-dados", { maxRedirects: 0 });
  expect([303, 307]).toContain(res.status());
  expect(res.headers().location).toMatch(/\/entrar\?next=%2Fmeus-dados$/);
  expect(res.headers()["content-disposition"]).toBeUndefined();
});

test.describe("download com o Supabase local", () => {
  test.skip(!LIVE, "precisa do Supabase local e da chave de serviço local (ver o topo do arquivo)");
  test.describe.configure({ mode: "serial" });

  const run = Date.now();
  const people = {
    a: { email: `dados.a.${run}@exemplo.org`, name: "Pessoa Exporta A", phone: `11 9${String(run).slice(-8)}`, city: "São Paulo" },
    b: { email: `dados.b.${run}@exemplo.org`, name: "Pessoa Exporta B", phone: `11 9${String(run + 1).slice(-8)}`, city: "Osasco" },
  };
  const pages: Partial<Record<keyof typeof people, Page>> = {};
  const e164 = (typed: string) => `+55${typed.replace(/\D/g, "")}`;

  const admin = (path: string, init: RequestInit) =>
    fetch(`${API}${path}`, {
      ...init,
      headers: { apikey: SERVICE_KEY!, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json", ...init.headers },
    });

  /** Cria a conta pelo Auth local, entra pelo link, preenche o perfil e é liberada pelo "gestor". */
  async function signUp(browser: Browser, baseURL: string, who: keyof typeof people): Promise<Page> {
    const person = people[who];
    const link = await (await admin("/auth/v1/admin/generate_link", { method: "POST", body: JSON.stringify({ type: "magiclink", email: person.email }) })).json();
    const page = await (await browser.newContext({ acceptDownloads: true })).newPage();
    await page.goto(`/auth/confirmar?token_hash=${link.hashed_token}&type=${link.verification_type}`);
    await page.getByRole("button", { name: "Entrar" }).click();
    await expect(page).toHaveURL(`${baseURL}/perfil`);
    await page.getByLabel("Seu nome").fill(person.name);
    await page.getByLabel("Seu WhatsApp, com DDD").fill(person.phone);
    await page.getByLabel("Sua cidade").selectOption({ label: person.city });
    await page.getByRole("button", { name: "Salvar meus dados" }).click();
    await expect(page).toHaveURL(`${baseURL}/espera`);
    const res = await admin(`/rest/v1/profiles?id=eq.${link.id}`, {
      method: "PATCH",
      body: JSON.stringify({ access_status: "active", status: "active" }),
    });
    expect(res.ok).toBe(true);
    return page;
  }

  async function download(page: Page) {
    await page.goto("/inicio");
    const [file] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Baixar meus dados" }).click()]);
    const chunks: Buffer[] = [];
    for await (const chunk of await file.createReadStream()) chunks.push(chunk as Buffer);
    return { name: file.suggestedFilename(), text: Buffer.concat(chunks).toString("utf8") };
  }

  test("cada pessoa baixa só os próprios dados, decifrados", async ({ browser, baseURL }) => {
    test.setTimeout(120_000);
    pages.a = await signUp(browser, baseURL!, "a");
    pages.b = await signUp(browser, baseURL!, "b");

    const a = await download(pages.a);
    expect(a.name).toMatch(/^meus-dados-\d{4}-\d{2}-\d{2}\.json$/);
    const file = JSON.parse(a.text);
    expect(file.conta.emailDeLogin).toBe(people.a.email);
    expect(file.perfil).toMatchObject({ nome: people.a.name, municipio: { nome: "São Paulo", uf: "SP" }, liberacaoDeAcesso: "active" });
    expect(file.contato).toMatchObject({ whatsapp: e164(people.a.phone), redesSociais: [] });
    expect(file.vinculos.map((v: { unidade: string }) => v.unidade)).toContain("São Paulo");
    expect(file.registrosSobreVoce.map((r: { evento: string }) => r.evento)).toContain("data_exported");
    for (const leak of [people.b.email, people.b.name, e164(people.b.phone), "hmac"]) expect(a.text).not.toContain(leak);

    const b = JSON.parse((await download(pages.b)).text);
    expect(b.perfil.nome).toBe(people.b.name);
    for (const leak of [people.a.email, people.a.name, e164(people.a.phone)]) expect(JSON.stringify(b)).not.toContain(leak);
  });

  test("cabeçalhos do download e origem conferida", async ({ baseURL }) => {
    const page = pages.a!;
    const res = await page.request.post("/meus-dados", { headers: { Origin: baseURL! }, maxRedirects: 0 });
    expect(res.status()).toBe(200);
    const h = res.headers();
    expect(h["content-type"]).toBe("application/json; charset=utf-8");
    expect(h["content-disposition"]).toMatch(/^attachment; filename="meus-dados-\d{4}-\d{2}-\d{2}\.json"$/);
    expect(h["cache-control"]).toBe("private, no-store");
    expect((await res.text()).startsWith('{\n  "sobre"')).toBe(true);

    // POST vindo de outro site (ou sem Origin): recusado, sem gastar o limite.
    const foreign = await page.request.post("/meus-dados", { headers: { Origin: "https://mal.exemplo" }, maxRedirects: 0 });
    expect(foreign.status()).toBe(403);
  });

  test("limite: a 6ª exportação na mesma hora volta para o início com aviso", async () => {
    const page = pages.a!;
    // A já exportou 2 vezes; mais 3 chegam a 5.
    for (let i = 0; i < 3; i++) {
      const res = await page.request.post("/meus-dados", { headers: { Origin: new URL(page.url()).origin }, maxRedirects: 0 });
      expect(res.status()).toBe(200);
    }
    await page.goto("/inicio");
    await page.getByRole("button", { name: "Baixar meus dados" }).click();
    await expect(page).toHaveURL(/\/inicio\?dados=limite$/);
    await expect(page.getByRole("main").getByRole("alert")).toContainText("várias vezes na última hora");
    // O limite é por pessoa: B continua baixando.
    expect(JSON.parse((await download(pages.b!)).text).perfil.nome).toBe(people.b.name);
  });
});
