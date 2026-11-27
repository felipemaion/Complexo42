import { expect, test, type Browser, type Page } from "@playwright/test";
import { acceptTermIfAsked } from "./accept-term";
import { chooseCity } from "./choose-city";

// "Quem vê meu contato" (#119, ADR 0010). Sem Supabase (job "E2E" do CI): só a proteção da rota. Com o
// Supabase local, o fluxo real: A e B se cadastram, são liberadas e postas na mesma equipe
// (como faria a coordenação); A autoriza a equipe a ver o WhatsApp, B vê (pela função do banco,
// com o JWT dela: a tela de membros é de outra issue), A vê o registro, volta para "só a
// coordenação" e B deixa de ver na hora. Para rodar (stack local de pé, `site_url` do
// supabase/config.toml apontando para a porta do E2E):
//   E2E_LIVE_SUPABASE_URL=<API_URL> E2E_LIVE_ANON_KEY=<ANON_KEY> \
//   E2E_LIVE_SERVICE_KEY=<SERVICE_ROLE_KEY do `supabase status`> npm run test:e2e -- e2e/contact-visibility.spec.ts
// A chave de serviço do stack LOCAL fica só neste processo de teste; o app nunca a recebe (R6).
const API = process.env.E2E_LIVE_SUPABASE_URL;
const ANON_KEY = process.env.E2E_LIVE_ANON_KEY;
const SERVICE_KEY = process.env.E2E_LIVE_SERVICE_KEY;
const LIVE = Boolean(API && ANON_KEY && SERVICE_KEY);

test("sem sessão, a tela manda para o login", async ({ page }) => {
  await page.goto("/perfil/contato");
  await expect(page).toHaveURL(/\/entrar\?next=%2Fperfil%2Fcontato$/);
});

test.describe("quem vê meu contato com o Supabase local", () => {
  test.skip(!LIVE, "precisa do Supabase local e das chaves locais (ver o topo do arquivo)");
  test.describe.configure({ mode: "serial" });

  const run = Date.now();
  const people = {
    a: { email: `contato.a.${run}@exemplo.org`, name: "Pessoa Contato A", phone: `11 9${String(run).slice(-8)}`, city: "São Paulo" },
    b: { email: `contato.b.${run}@exemplo.org`, name: "Pessoa Contato B", phone: `11 9${String(run + 1).slice(-8)}`, city: "Osasco" },
  };
  const ids: Partial<Record<keyof typeof people, string>> = {};
  let pageA: Page;
  let tokenB = "";

  const admin = (path: string, init: RequestInit = {}) =>
    fetch(`${API}${path}`, {
      ...init,
      headers: { apikey: SERVICE_KEY!, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json", ...init.headers },
    });

  async function signUp(browser: Browser, baseURL: string, who: keyof typeof people): Promise<Page> {
    const person = people[who];
    const link = await (await admin("/auth/v1/admin/generate_link", { method: "POST", body: JSON.stringify({ type: "magiclink", email: person.email }) })).json();
    ids[who] = link.id;
    const page = await (await browser.newContext()).newPage();
    await page.goto(`/auth/confirmar?token_hash=${link.hashed_token}&type=${link.verification_type}`);
    await page.getByRole("button", { name: "Entrar" }).click();
    await acceptTermIfAsked(page);
    await expect(page).toHaveURL(`${baseURL}/perfil`);
    await page.getByLabel("Seu nome").fill(person.name);
    await page.getByLabel("Seu WhatsApp, com DDD").fill(person.phone);
    await chooseCity(page, person.city);
    await page.getByRole("button", { name: "Salvar meus dados" }).click();
    await expect(page).toHaveURL(`${baseURL}/espera`);
    const res = await admin(`/rest/v1/profiles?id=eq.${link.id}`, {
      method: "PATCH",
      body: JSON.stringify({ access_status: "active", status: "active" }),
    });
    expect(res.ok).toBe(true);
    return page;
  }

  /** Tira a pessoa da unidade do estado e a põe na equipe (o que a coordenação faria). */
  async function joinTeam(profileId: string, teamId: string) {
    const close = await admin(`/rest/v1/unit_members?profile_id=eq.${profileId}&left_at=is.null`, {
      method: "PATCH",
      body: JSON.stringify({ left_at: new Date().toISOString() }),
    });
    expect(close.ok).toBe(true);
    const join = await admin("/rest/v1/unit_members", { method: "POST", body: JSON.stringify({ unit_id: teamId, profile_id: profileId }) });
    expect(join.ok).toBe(true);
  }

  /** B chama view_contact com o próprio JWT, como o servidor faria. */
  const viewAsB = (kind: string) =>
    fetch(`${API}/rest/v1/rpc/view_contact`, {
      method: "POST",
      headers: { apikey: ANON_KEY!, Authorization: `Bearer ${tokenB}`, "Content-Type": "application/json" },
      body: JSON.stringify({ p_target: ids.a, p_kind: kind }),
    });

  const whatsappGroup = () => pageA.getByRole("group", { name: "Seu WhatsApp" });

  test("A autoriza a equipe; B vê o WhatsApp (cifrado) e não o e-mail; A vê quem viu", async ({ browser, baseURL }) => {
    test.setTimeout(120_000);
    pageA = await signUp(browser, baseURL!, "a");
    await signUp(browser, baseURL!, "b");

    const teams = await (await admin("/rest/v1/units?path=eq.br.sp.abc.equipe_1&select=id")).json();
    expect(teams).toHaveLength(1);
    await joinTeam(ids.a!, teams[0].id);
    await joinTeam(ids.b!, teams[0].id);

    const link = await (await admin("/auth/v1/admin/generate_link", { method: "POST", body: JSON.stringify({ type: "magiclink", email: people.b.email }) })).json();
    const session = await (
      await fetch(`${API}/auth/v1/verify`, {
        method: "POST",
        headers: { apikey: ANON_KEY!, "Content-Type": "application/json" },
        body: JSON.stringify({ type: "magiclink", token_hash: link.hashed_token }),
      })
    ).json();
    tokenB = session.access_token;
    expect(tokenB).toBeTruthy();

    // Padrão: só a coordenação. B, colega de equipe, não vê.
    expect((await viewAsB("whatsapp")).status).toBe(403);

    await pageA.goto("/inicio");
    await pageA.getByRole("link", { name: "Quem vê meu contato" }).click();
    await expect(pageA).toHaveURL(`${baseURL}/perfil/contato`);
    await expect(whatsappGroup().getByRole("button", { name: "Só a coordenação", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(pageA.getByText("Ninguém viu seu contato até agora.")).toBeVisible();

    await whatsappGroup().getByRole("button", { name: "Minha equipe", exact: true }).click();
    await expect(pageA).toHaveURL(`${baseURL}/perfil/contato?escolha=salva`);
    await expect(pageA.getByRole("status")).toContainText("Sua escolha foi salva");
    await expect(whatsappGroup().getByRole("button", { name: "Minha equipe", exact: true })).toHaveAttribute("aria-pressed", "true");

    // Vale na hora: B vê o WhatsApp (o banco devolve o valor cifrado; quem decifra é o servidor).
    const seen = await viewAsB("whatsapp");
    expect(seen.status).toBe(200);
    const value = await seen.json();
    expect(value).toMatch(/^v\d+\./);
    expect(value).not.toContain(people.a.phone.replace(/\D/g, ""));
    // O e-mail continua só para a coordenação.
    expect((await viewAsB("email")).status).toBe(403);

    await pageA.reload();
    await expect(pageA.getByTestId("contact-views")).toContainText(`${people.b.name} viu seu WhatsApp em`);
  });

  test("A volta para \"só a coordenação\" e B deixa de ver na hora", async ({ baseURL }) => {
    await pageA.goto("/perfil/contato");
    await whatsappGroup().getByRole("button", { name: "Só a coordenação", exact: true }).click();
    await expect(pageA).toHaveURL(`${baseURL}/perfil/contato?escolha=salva`);
    await expect(whatsappGroup().getByRole("button", { name: "Só a coordenação", exact: true })).toHaveAttribute("aria-pressed", "true");
    expect((await viewAsB("whatsapp")).status).toBe(403);
  });
});
