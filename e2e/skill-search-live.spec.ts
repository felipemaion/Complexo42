import { expect, test, type Page } from "@playwright/test";
import { giveHouse } from "./give-house";

// Busca de pessoas por habilidade (#23) contra um Supabase local: a nacional vê todos, o gestor de estado só o
// escopo dele, quem não tem papel recebe 404, os filtros ficam na URL e a lista não traz contato. Para rodar
// localmente, com o banco de pé:
//   E2E_LIVE_SUPABASE_URL=<API_URL> E2E_LIVE_ANON_KEY=<ANON_KEY> \
//   E2E_LIVE_SERVICE_ROLE_KEY=<SERVICE_ROLE_KEY> npm run test:e2e -- skill-search-live
const API = process.env.E2E_LIVE_SUPABASE_URL;
const SERVICE = process.env.E2E_LIVE_SERVICE_ROLE_KEY;
test.skip(!API || !SERVICE, "precisa do Supabase local e da chave service_role");

const SAO_PAULO = 3550308;

const admin = (path: string, init: RequestInit = {}) =>
  fetch(`${API}${path}`, {
    ...init,
    headers: { apikey: SERVICE!, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json", ...init.headers },
  });

async function unitId(path: string): Promise<string> {
  const [unit] = await (await admin(`/rest/v1/units?path=eq.${path}&select=id`)).json();
  return unit.id;
}

async function createPerson(tag: string, inUnit?: string): Promise<{ id: string; email: string; password: string }> {
  const email = `busca.${tag}.${Date.now()}@exemplo.org`;
  const password = `Busca-${tag}-${Date.now()}-teste-longa`;
  const user = await (await admin("/auth/v1/admin/users", { method: "POST", body: JSON.stringify({ email, password, email_confirm: true }) })).json();
  const res = await admin("/rest/v1/profiles", {
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
  expect(res.status).toBe(201);
  await giveHouse(admin, user.id);
  await admin("/rest/v1/consent_acceptances", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ user_id: user.id, version: "v1" }) });
  if (inUnit) {
    await admin(`/rest/v1/unit_members?profile_id=eq.${user.id}&left_at=is.null`, { method: "PATCH", body: JSON.stringify({ left_at: new Date().toISOString() }) });
    const placed = await admin("/rest/v1/unit_members", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ unit_id: await unitId(inUnit), profile_id: user.id }) });
    expect(placed.status).toBe(201);
  }
  return { id: user.id, email, password };
}

async function makeManager(personId: string, path: string): Promise<void> {
  const res = await admin("/rest/v1/role_assignments", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ profile_id: personId, role: "manager", unit_id: await unitId(path) }),
  });
  expect(res.status).toBe(201);
}

async function skillId(name: string): Promise<string> {
  const [skill] = await (await admin(`/rest/v1/skills?name=eq.${encodeURIComponent(name)}&select=id`)).json();
  return skill.id;
}

// Ninguém grava `profile_skills` direto (nem a service_role): a pessoa marca pela função `set_my_skills`, com a sessão dela.
async function giveSkills(person: { email: string; password: string }, ids: string[]): Promise<void> {
  const login = await fetch(`${API}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: process.env.E2E_LIVE_ANON_KEY!, "Content-Type": "application/json" },
    body: JSON.stringify({ email: person.email, password: person.password }),
  });
  expect(login.ok).toBe(true);
  const { access_token } = (await login.json()) as { access_token: string };
  const res = await fetch(`${API}/rest/v1/rpc/set_my_skills`, {
    method: "POST",
    headers: { apikey: process.env.E2E_LIVE_ANON_KEY!, Authorization: `Bearer ${access_token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ p_skill_ids: ids }),
  });
  expect(res.ok).toBe(true);
}

async function signIn(page: Page, email: string): Promise<void> {
  const link = await (await admin("/auth/v1/admin/generate_link", { method: "POST", body: JSON.stringify({ type: "magiclink", email }) })).json();
  await page.goto(`/auth/confirmar?token_hash=${link.hashed_token ?? link.properties?.hashed_token}&type=email`);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/(inicio|casa)$/);
}

const found = (page: Page, id: string) => page.locator(`[data-testid="person-result"][data-person-id="${id}"]`);

test("a nacional busca por habilidade (E e OU), o gestor de estado só vê o escopo dele e quem não tem papel recebe 404", async ({ browser }) => {
  test.setTimeout(150_000);
  const [oratoria, debate] = await Promise.all([skillId("Falar em público"), skillId("Debate")]);
  const root = await createPerson("raiz");
  await makeManager(root.id, "br");
  const state = await createPerson("sp");
  await makeManager(state.id, "br.sp");
  const plain = await createPerson("comum");
  const inSp = await createPerson("em-sp");
  const inMg = await createPerson("em-mg", "br.mg");
  await giveSkills(inSp, [oratoria, debate]);
  await giveSkills(inMg, [oratoria]);

  const rootContext = await browser.newContext();
  const rootPage = await rootContext.newPage();
  await signIn(rootPage, root.email);
  // Qualquer uma (OU): as duas pessoas.
  await rootPage.goto(`/coordenacao/pessoas?h=${oratoria}&modo=qualquer`);
  await expect(found(rootPage, inSp.id)).toHaveCount(1);
  await expect(found(rootPage, inMg.id)).toHaveCount(1);
  // Todas (E): só quem tem as duas.
  await rootPage.goto(`/coordenacao/pessoas?h=${oratoria}&h=${debate}&modo=todas`);
  await expect(found(rootPage, inSp.id)).toHaveCount(1);
  await expect(found(rootPage, inMg.id)).toHaveCount(0);
  // A lista não traz contato.
  // (o resto da página, como o cabeçalho, pode ter outros textos: o que importa é o conteúdo de cada cartão)
  const cards = (await rootPage.locator('[data-testid="person-result"]').allInnerTexts()).join(" ").toLowerCase();
  expect(cards).not.toMatch(/whatsapp|wa\.me|\+55|contato/);
  await rootContext.close();

  const stateContext = await browser.newContext();
  const statePage = await stateContext.newPage();
  await signIn(statePage, state.email);
  await statePage.goto(`/coordenacao/pessoas?h=${oratoria}&modo=qualquer`);
  await expect(found(statePage, inSp.id)).toHaveCount(1);
  await expect(found(statePage, inMg.id)).toHaveCount(0);
  await stateContext.close();

  const plainContext = await browser.newContext();
  const plainPage = await plainContext.newPage();
  await signIn(plainPage, plain.email);
  expect((await plainPage.goto(`/coordenacao/pessoas?h=${oratoria}`))?.status()).toBe(404);
  await plainContext.close();
});

test("o autocomplete acha por sinônimo, os filtros ficam na URL e a busca grava o evento", async ({ page }) => {
  const root = await createPerson("raiz-auto");
  await makeManager(root.id, "br");
  await signIn(page, root.email);
  await page.goto("/coordenacao/pessoas");
  // "oratória" é sinônimo de "Falar em público" (sem acento e sem caixa).
  await page.getByRole("combobox", { name: "Buscar habilidade" }).fill("ORATORIA");
  await page.getByRole("option").first().click();
  await expect(page.getByTestId("chosen-skill")).toHaveCount(1);
  await page.getByRole("button", { name: "Buscar pessoas" }).click();
  await expect(page).toHaveURL(/[?&]h=/);
  const events = (await (await admin(`/rest/v1/audit_log?actor_id=eq.${root.id}&event=eq.skills_searched&select=id`)).json()) as unknown[];
  expect(events.length).toBeGreaterThanOrEqual(1);
});
