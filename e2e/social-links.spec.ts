import { expect, test, type Browser, type Page } from "@playwright/test";
import { acceptTermIfAsked } from "./accept-term";

// Redes sociais (#17). Sem Supabase (o CI): só a proteção da rota. Com o Supabase local, o fluxo
// real: a pessoa se cadastra pondo links, um `javascript:` é recusado só naquela caixa, o banco
// guarda os links cifrados, a página inicial mostra cada link como texto com
// rel="noopener noreferrer nofollow", e mudar só o nome mantém os links. Para rodar (stack local
// de pé, `site_url` do supabase/config.toml apontando para a porta do E2E):
//   E2E_LIVE_SUPABASE_URL=<API_URL> E2E_LIVE_ANON_KEY=<ANON_KEY> \
//   E2E_LIVE_SERVICE_KEY=<SERVICE_ROLE_KEY do `supabase status`> npm run test:e2e -- e2e/social-links.spec.ts
// A chave de serviço do stack LOCAL fica só neste processo de teste; o app nunca a recebe (R6).
const API = process.env.E2E_LIVE_SUPABASE_URL;
const ANON_KEY = process.env.E2E_LIVE_ANON_KEY;
const SERVICE_KEY = process.env.E2E_LIVE_SERVICE_KEY;
const LIVE = Boolean(API && ANON_KEY && SERVICE_KEY);

test("sem sessão, o formulário com as redes manda para o login", async ({ page }) => {
  await page.goto("/perfil");
  await expect(page).toHaveURL(/\/entrar\?next=%2Fperfil$/);
});

test.describe("redes sociais com o Supabase local", () => {
  test.skip(!LIVE, "precisa do Supabase local e das chaves locais (ver o topo do arquivo)");
  test.describe.configure({ mode: "serial" });

  const run = Date.now();
  const email = `redes.${run}@exemplo.org`;
  const phone = `11 9${String(run).slice(-8)}`;
  let profileId = "";
  let page: Page;

  const admin = (path: string, init: RequestInit = {}) =>
    fetch(`${API}${path}`, {
      ...init,
      headers: { apikey: SERVICE_KEY!, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json", ...init.headers },
    });

  async function signIn(browser: Browser): Promise<Page> {
    const link = await (await admin("/auth/v1/admin/generate_link", { method: "POST", body: JSON.stringify({ type: "magiclink", email }) })).json();
    profileId = link.id;
    const p = await (await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true })).newPage();
    // Nenhum alert() pode abrir: se abrir, o teste falha.
    p.on("dialog", (dialog) => {
      throw new Error(`diálogo inesperado: ${dialog.type()}`);
    });
    await p.goto(`/auth/confirmar?token_hash=${link.hashed_token}&type=${link.verification_type}`);
    await p.getByRole("button", { name: "Entrar" }).click();
    return p;
  }

  test("cadastro com links: javascript: recusado na caixa certa; links cifrados no banco", async ({ browser, baseURL }) => {
    page = await signIn(browser);
    await acceptTermIfAsked(page);
    await expect(page).toHaveURL(`${baseURL}/perfil`);
    await page.getByLabel("Seu nome").fill("Pessoa Redes");
    await page.getByLabel("Seu WhatsApp, com DDD").fill(phone);
    await page.getByLabel("Sua cidade").selectOption({ label: "Osasco" });

    // Uma caixa já aparece; mais uma pelo botão grande, que leva o foco para a caixa nova.
    const add = page.getByRole("button", { name: "Pôr mais um link" });
    expect((await add.boundingBox())?.height).toBeGreaterThanOrEqual(56);
    await page.getByLabel("Link 1", { exact: true }).fill("instagram.com/pessoa.redes");
    await add.click();
    await expect(page.getByLabel("Link 2", { exact: true })).toBeFocused();
    await page.getByLabel("Link 2", { exact: true }).fill("javascript:alert(1)");

    const save = page.getByRole("button", { name: "Salvar meus dados" });
    await save.click();
    const summary = page.getByRole("main").getByRole("alert");
    await expect(summary).toBeFocused();
    await expect(summary).toContainText("Confira os links");
    await expect(page.getByLabel("Link 2", { exact: true })).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByLabel("Link 1", { exact: true })).toHaveAttribute("aria-invalid", "false");
    await expect(page.getByLabel("Link 1", { exact: true })).toHaveValue("instagram.com/pessoa.redes");

    await page.getByLabel("Link 2", { exact: true }).fill("https://www.youtube.com/@pessoa.redes");
    await save.click();
    // Perfil novo nasce pendente (fora da lista de autorizados): vai para a espera.
    await expect(page).toHaveURL(`${baseURL}/espera`);

    // No banco, só o valor cifrado (R13).
    const rows = await (await admin(`/rest/v1/profile_contacts?profile_id=eq.${profileId}&select=social_links_enc`)).json();
    expect(rows).toHaveLength(1);
    expect(rows[0].social_links_enc).toMatch(/^v\d+\./);
    expect(rows[0].social_links_enc).not.toContain("pessoa.redes");

    // Liberada, como a coordenação faria.
    const res = await admin(`/rest/v1/profiles?id=eq.${profileId}`, {
      method: "PATCH",
      body: JSON.stringify({ access_status: "active", status: "active" }),
    });
    expect(res.ok).toBe(true);
  });

  test("a página inicial mostra os links como texto, com rel seguro", async ({ baseURL }) => {
    await page.goto("/inicio");
    await expect(page).toHaveURL(`${baseURL}/inicio`);
    const list = page.getByRole("list", { name: "Suas redes sociais" });
    const instagram = list.getByRole("link", { name: "instagram.com/pessoa.redes" });
    await expect(instagram).toHaveAttribute("href", "https://instagram.com/pessoa.redes");
    await expect(instagram).toHaveAttribute("rel", "noopener noreferrer nofollow");
    await expect(instagram).not.toHaveAttribute("target");
    await expect(list.getByRole("link", { name: "youtube.com/@pessoa.redes" })).toHaveAttribute(
      "href",
      "https://www.youtube.com/@pessoa.redes",
    );
    await expect(list.getByRole("link")).toHaveCount(2);
    expect(await page.locator('a[href^="javascript:"], a[href^="data:"]').count()).toBe(0);
  });

  test("mudar só o nome mantém os links; tirar um link e o limite de 5", async ({ baseURL }) => {
    await page.goto("/perfil");
    await expect(page.getByLabel("Link 1", { exact: true })).toHaveValue("https://instagram.com/pessoa.redes");
    await expect(page.getByLabel("Link 2", { exact: true })).toHaveValue("https://www.youtube.com/@pessoa.redes");
    await page.getByLabel("Seu nome").fill("Pessoa Redes Nova");
    await page.getByRole("button", { name: "Salvar meus dados" }).click();
    await expect(page).toHaveURL(`${baseURL}/inicio?salvo=1`);
    await expect(page.getByRole("list", { name: "Suas redes sociais" }).getByRole("link")).toHaveCount(2);

    // Até 5 caixas: depois da 5ª, o botão de pôr mais some.
    await page.goto("/perfil");
    const add = page.getByRole("button", { name: "Pôr mais um link" });
    for (const n of [3, 4, 5]) {
      await add.click();
      await page.getByLabel(`Link ${n}`, { exact: true }).fill(`https://rede.example/p${n}`);
    }
    await expect(add).toHaveCount(0);

    // Tirar o link 1 (botão grande); o foco volta para o botão de pôr mais.
    await page.getByRole("button", { name: "Tirar o link 1" }).click();
    await expect(page.getByLabel("Link 1", { exact: true })).toHaveValue("https://www.youtube.com/@pessoa.redes");
    await expect(page.getByRole("button", { name: "Pôr mais um link" })).toBeFocused();
    await page.getByRole("button", { name: "Salvar meus dados" }).click();
    await expect(page).toHaveURL(`${baseURL}/inicio?salvo=1`);
    const links = page.getByRole("list", { name: "Suas redes sociais" }).getByRole("link");
    await expect(links).toHaveCount(4);
    await expect(links.first()).toHaveText("youtube.com/@pessoa.redes");
    await page.context().close();
  });
});
