import { expect, test, type Page } from "@playwright/test";
import { giveHouse } from "./give-house";

// Catálogo de habilidades (#25): a coordenação nacional cria, renomeia e mescla; contra um Supabase local. Para rodar localmente, com o banco de pé:
//   E2E_LIVE_SUPABASE_URL=<API_URL> E2E_LIVE_ANON_KEY=<ANON_KEY> \
//   E2E_LIVE_SERVICE_ROLE_KEY=<SERVICE_ROLE_KEY> npm run test:e2e -- skill-catalog-live
const API = process.env.E2E_LIVE_SUPABASE_URL;
const SERVICE = process.env.E2E_LIVE_SERVICE_ROLE_KEY;
test.skip(!API || !SERVICE, "precisa do Supabase local e da chave service_role");

const SAO_PAULO = 3550308;

const admin = (path: string, init: RequestInit = {}) =>
  fetch(`${API}${path}`, {
    ...init,
    headers: { apikey: SERVICE!, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json", ...init.headers },
  });

async function createPerson(tag: string): Promise<{ id: string; email: string }> {
  const email = `hab.${tag}.${Date.now()}@exemplo.org`;
  const user = await (await admin("/auth/v1/admin/users", { method: "POST", body: JSON.stringify({ email, email_confirm: true }) })).json();
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
  return { id: user.id, email };
}

async function makeRootManager(personId: string): Promise<void> {
  const [unit] = await (await admin("/rest/v1/units?path=eq.br&select=id")).json();
  const res = await admin("/rest/v1/role_assignments", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ profile_id: personId, role: "manager", unit_id: unit.id }),
  });
  expect(res.status).toBe(201);
}

async function signIn(page: Page, email: string): Promise<void> {
  const link = await (await admin("/auth/v1/admin/generate_link", { method: "POST", body: JSON.stringify({ type: "magiclink", email }) })).json();
  await page.goto(`/auth/confirmar?token_hash=${link.hashed_token ?? link.properties?.hashed_token}&type=email`);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/(inicio|casa)$/);
}

const skillsByName = async (name: string) =>
  (await (await admin(`/rest/v1/skills?name=eq.${encodeURIComponent(name)}&select=id,category,active`)).json()) as { id: string; category: string; active: boolean }[];

test("a coordenação nacional cria, renomeia e mescla; quem não é nacional recebe 404", async ({ browser }) => {
  test.setTimeout(120_000);
  const root = await createPerson("raiz-cat");
  const person = await createPerson("comum-cat");
  await makeRootManager(root.id);
  const stamp = Date.now();
  const first = `Cestaria ${stamp}`;
  const second = `Cesteiro ${stamp}`;
  const renamed = `Cestaria de palha ${stamp}`;

  const personContext = await browser.newContext();
  const personPage = await personContext.newPage();
  await signIn(personPage, person.email);
  expect((await personPage.goto("/coordenacao/habilidades/catalogo"))?.status()).toBe(404);
  await personContext.close();

  const context = await browser.newContext();
  const page = await context.newPage();
  await signIn(page, root.email);
  await page.goto("/coordenacao/habilidades/catalogo");
  for (const name of [first, second]) {
    const form = page.locator("section", { has: page.getByRole("heading", { name: "Nova habilidade" }) });
    await form.getByLabel("Nome").fill(name);
    await form.getByLabel("Grupo").fill("Ofícios do teste");
    await form.getByRole("button", { name: "Criar habilidade" }).click();
    await expect(page.getByText("Mudança registrada.")).toBeVisible();
  }
  // Nome repetido (sem caixa) é recusado.
  const create = page.locator("section", { has: page.getByRole("heading", { name: "Nova habilidade" }) });
  await create.getByLabel("Nome").fill(first.toUpperCase());
  await create.getByLabel("Grupo").fill("Ofícios do teste");
  await create.getByRole("button", { name: "Criar habilidade" }).click();
  await expect(page.getByRole("alert")).toBeVisible();

  // Renomear.
  let row = page.locator(`[data-testid="catalog-skill"][data-name="${first}"]`);
  await row.getByLabel("Nome", { exact: true }).fill(renamed);
  await row.getByRole("button", { name: "Renomear", exact: true }).click();
  await expect(page.getByText("Mudança registrada.")).toBeVisible();
  const [kept] = await skillsByName(renamed);
  expect(kept).toBeDefined();

  // Mesclar a segunda na renomeada: a segunda fica desativada.
  row = page.locator(`[data-testid="catalog-skill"][data-name="${second}"]`);
  await row.getByLabel(/Mesclar nesta habilidade/).selectOption({ label: renamed });
  await row.getByRole("button", { name: "Mesclar" }).click();
  await expect(page.getByText("Mudança registrada.")).toBeVisible();
  expect((await skillsByName(second))[0]).toMatchObject({ active: false });
  expect((await skillsByName(renamed))[0]).toMatchObject({ active: true });
  await context.close();
});
