import { expect, test, type Page } from "@playwright/test";
import { giveHouse } from "./give-house";

// Habilidades (#15): a pessoa marca (sem nível, no máximo 10), sugere uma nova e a coordenação nacional a
// aprova; contra um Supabase local. Para rodar localmente, com o banco de pé:
//   E2E_LIVE_SUPABASE_URL=<API_URL> E2E_LIVE_ANON_KEY=<ANON_KEY> \
//   E2E_LIVE_SERVICE_ROLE_KEY=<SERVICE_ROLE_KEY> npm run test:e2e -- skills-live
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

const savedSkills = async (profileId: string): Promise<string[]> =>
  ((await (await admin(`/rest/v1/profile_skills?profile_id=eq.${profileId}&select=skill_id`)).json()) as { skill_id: string }[]).map((r) => r.skill_id);

test("a pessoa marca habilidades (sem nível), o contador para em 10 e a busca ignora acento", async ({ page }) => {
  const person = await createPerson("marca");
  await signIn(page, person.email);
  await page.goto("/inicio");
  await page.getByRole("link", { name: "Minhas habilidades" }).click();
  await expect(page).toHaveURL(/\/perfil\/habilidades$/);
  await expect(page.getByTestId("skills-counter")).toContainText("0 de 10");
  // Nenhum campo de nível: só marcar.
  await expect(page.getByRole("combobox")).toHaveCount(0);
  const boxes = page.getByRole("checkbox");
  expect(await boxes.count()).toBeGreaterThanOrEqual(11);
  for (let i = 0; i < 10; i += 1) await boxes.nth(i).check();
  await expect(page.getByTestId("skills-counter")).toContainText("10 de 10");
  // No limite, as outras ficam desabilitadas na tela (o banco confere de qualquer jeito).
  await expect(boxes.nth(10)).toBeDisabled();
  await page.getByRole("button", { name: "Salvar habilidades" }).click();
  await expect(page.getByText("Habilidades salvas.")).toBeVisible();
  expect(await savedSkills(person.id)).toHaveLength(10);
  // Desmarcar uma e salvar: 9.
  await boxes.first().uncheck();
  await page.getByRole("button", { name: "Salvar habilidades" }).click();
  await expect(page.getByText("Habilidades salvas.")).toBeVisible();
  expect(await savedSkills(person.id)).toHaveLength(9);
  // A busca ignora caixa e acento.
  await page.getByLabel("Buscar habilidade").fill("ORATORIA");
  await expect(page.getByRole("checkbox").first()).toBeVisible();
});

test("sugerir uma habilidade nova; a coordenação nacional aprova e ela entra no catálogo e na pessoa", async ({ browser }) => {
  test.setTimeout(120_000);
  const person = await createPerson("sugere");
  const root = await createPerson("raiz-hab");
  await makeRootManager(root.id);
  const name = `Cestaria ${Date.now()}`;

  const personContext = await browser.newContext();
  const personPage = await personContext.newPage();
  await signIn(personPage, person.email);
  await personPage.goto("/perfil/habilidades");
  await personPage.getByLabel("Nome da habilidade").fill(name);
  await personPage.getByRole("button", { name: "Sugerir habilidade" }).click();
  await expect(personPage.getByText("Sugestão enviada")).toBeVisible();
  await expect(personPage.getByTestId("my-suggestion").first()).toContainText(name);
  // Nome com caractere invisível é recusado (sem texto livre perigoso no catálogo).
  await personPage.getByLabel("Nome da habilidade").fill("Ma​ria");
  await personPage.getByRole("button", { name: "Sugerir habilidade" }).click();
  await expect(personPage.getByRole("alert")).toBeVisible();
  // A pessoa comum não abre a fila da coordenação.
  expect((await personPage.goto("/coordenacao/habilidades"))?.status()).toBe(404);

  const context = await browser.newContext();
  const page = await context.newPage();
  await signIn(page, root.email);
  await page.goto("/coordenacao/habilidades");
  const row = page.getByTestId("suggestion-row").filter({ hasText: name });
  await expect(row).toHaveCount(1);
  await row.getByLabel("Grupo").fill("Ofícios");
  await row.getByRole("button", { name: "Aprovar" }).click();
  await expect(page.getByText("Decisão registrada.")).toBeVisible();
  await expect(page.getByTestId("suggestion-row").filter({ hasText: name })).toHaveCount(0);
  await context.close();

  const [skill] = (await (await admin(`/rest/v1/skills?name=eq.${encodeURIComponent(name)}&select=id,category,active`)).json()) as { id: string; category: string; active: boolean }[];
  expect(skill).toMatchObject({ category: "Ofícios", active: true });
  expect(await savedSkills(person.id)).toContain(skill!.id);
  await personPage.goto("/perfil/habilidades");
  await expect(personPage.getByTestId("my-suggestion").first()).toContainText("aprovada");
  await personContext.close();
});
