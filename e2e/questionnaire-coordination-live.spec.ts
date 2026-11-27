import { readFileSync } from "node:fs";
import { expect, test, type Browser, type Page } from "@playwright/test";
import type { QuestionnaireConfig } from "../src/modules/questionnaire/domain/schema";
import { giveHouse } from "./give-house";

// Telas da coordenação do questionário (#174, ADR 0014) contra um Supabase local: resultados com o
// gráfico completo, fila de análise vazia, delegações e o 404 de quem
// não tem permissão. Os resultados nascem pelo caminho de verdade (a pessoa responde na tela e o
// servidor pontua, cifra e assina). Para rodar localmente, com o banco de pé:
//   E2E_LIVE_SUPABASE_URL=<API_URL> E2E_LIVE_ANON_KEY=<ANON_KEY> \
//   E2E_LIVE_SERVICE_ROLE_KEY=<SERVICE_ROLE_KEY> npm run test:e2e -- questionnaire-coordination-live
const API = process.env.E2E_LIVE_SUPABASE_URL;
const SERVICE = process.env.E2E_LIVE_SERVICE_ROLE_KEY;
test.skip(!API || !SERVICE, "precisa do Supabase local e da chave service_role");

const questionnaire = JSON.parse(readFileSync("config/questionnaire.example.json", "utf8")) as QuestionnaireConfig;
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

/** Pessoa ativa, em SP (estado), com o termo aceito. `inUnit` a move para outra unidade. */
/** `withHouse`: quem só usa as telas (coordenação, pessoa comum) tem a casa aceita (ADR 0017); quem responde o questionário não. */
async function createPerson(tag: string, inUnit?: string, withHouse = false): Promise<{ id: string; email: string }> {
  const email = `coord.${tag}.${Date.now()}@exemplo.org`;
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
  if (withHouse) await giveHouse(admin, user.id);
  await admin("/rest/v1/consent_acceptances", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ user_id: user.id, version: "v1" }) });
  if (inUnit) {
    await admin(`/rest/v1/unit_members?profile_id=eq.${user.id}&left_at=is.null`, { method: "PATCH", body: JSON.stringify({ left_at: new Date().toISOString() }) });
    const placed = await admin("/rest/v1/unit_members", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ unit_id: await unitId(inUnit), profile_id: user.id }),
    });
    expect(placed.status).toBe(201);
  }
  return { id: user.id, email };
}

async function makeManager(personId: string, path: string): Promise<void> {
  const res = await admin("/rest/v1/role_assignments", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ profile_id: personId, role: "manager", unit_id: await unitId(path) }),
  });
  expect(res.status).toBe(201);
}

async function signIn(page: Page, email: string): Promise<void> {
  const link = await (await admin("/auth/v1/admin/generate_link", { method: "POST", body: JSON.stringify({ type: "magiclink", email }) })).json();
  await page.goto(`/auth/confirmar?token_hash=${link.hashed_token ?? link.properties?.hashed_token}&type=email`);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/inicio$/);
}

/** A pessoa responde o questionário na tela (o servidor pontua, cifra e assina). */
async function answerQuestionnaire(browser: Browser, person: { email: string }, answers: Record<string, number>): Promise<void> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signIn(page, person.email);
  await page.goto("/casa");
  await page.getByRole("button", { name: "Aceito e quero responder" }).click();
  for (const item of questionnaire.items) {
    await page.getByTestId(`scale-${answers[item.id]}`).click();
    await page.getByRole("button", { name: /^(Próxima|Ver o resultado)$/ }).click();
  }
  await expect(page.getByText("Sugerimos esta casa para você")).toBeVisible();
  await context.close();
}

const allA: Record<string, number> = Object.fromEntries(questionnaire.items.map((item) => [item.id, -5]));
// Eixo 1 todo "muito b": outra casa que a de allA.
const houseB: Record<string, number> = { ...allA, q01: 5, q05: 5, q09: 5 };

async function viewedEvents(targetId: string): Promise<{ actor_id: string }[]> {
  return (await admin(`/rest/v1/audit_log?event=eq.questionnaire_result_viewed&target_id=eq.${targetId}&select=actor_id`)).json();
}

test("resultados, fila, delegação e 404 (ADR 0014, #174)", async ({ browser }) => {
  test.setTimeout(180_000);
  // Gente: a coordenação nacional (gestora da raiz), um gestor de SP (futuro delegado), duas pessoas
  // de SP com resultado, uma de Minas Gerais com resultado e uma pessoa comum (sem resultado).
  const root = await createPerson("raiz", undefined, true);
  await makeManager(root.id, "br");
  const state = await createPerson("sp", undefined, true);
  await makeManager(state.id, "br.sp");
  const first = await createPerson("a");
  const second = await createPerson("b");
  const outside = await createPerson("mg", "br.mg");
  const plain = await createPerson("comum", undefined, true);
  await answerQuestionnaire(browser, first, allA);
  await answerQuestionnaire(browser, second, houseB);
  await answerQuestionnaire(browser, outside, allA);

  // --- Pessoa comum: as telas não existem para ela (404), sem dizer que existem.
  const plainContext = await browser.newContext();
  const plainPage = await plainContext.newPage();
  await signIn(plainPage, plain.email);
  for (const path of ["/coordenacao/casas/resultados", "/coordenacao/casas/analise", "/coordenacao/casas/delegacoes", `/coordenacao/casas/resultados/${first.id}`]) {
    expect((await plainPage.goto(path))?.status(), path).toBe(404);
  }
  await plainContext.close();

  // --- Coordenação nacional.
  const rootContext = await browser.newContext();
  const page = await rootContext.newPage();
  await signIn(page, root.email);
  await page.goto("/coordenacao");
  await expect(page.getByRole("link", { name: "Resultados do questionário" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Casos para analisar" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Delegar acesso ao questionário" })).toBeVisible();

  // Lista: as três pessoas com resultado (a do estado de Minas também: a nacional vê todas), com casa e totem.
  await page.goto("/coordenacao/casas/resultados");
  for (const person of [first, second, outside]) {
    await expect(page.locator(`a[href="/coordenacao/casas/resultados/${person.id}"]`)).toHaveCount(1);
  }
  await expect(page.locator(`a[href="/coordenacao/casas/resultados/${plain.id}"]`)).toHaveCount(0);

  // Filtro por casa: só as que têm a casa escolhida.
  const houseOfFirst = await page.locator(`tr:has(a[href="/coordenacao/casas/resultados/${first.id}"]) td`).nth(1).innerText();
  await page.getByLabel("Casa sugerida").selectOption({ label: houseOfFirst });
  await page.getByRole("button", { name: "Filtrar" }).click();
  await expect(page.locator(`a[href="/coordenacao/casas/resultados/${first.id}"]`)).toHaveCount(1);
  await expect(page.locator(`a[href="/coordenacao/casas/resultados/${second.id}"]`)).toHaveCount(0);

  // A lista não mostra totem nem nota (só nome, casa e data): eles só aparecem ao abrir, que registra o acesso.
  await expect(page.locator("th", { hasText: "Totem" })).toHaveCount(0);
  await expect(page.locator(`tr:has(a[href="/coordenacao/casas/resultados/${first.id}"])`)).not.toContainText(/\b[A-Z]{2}\b/);

  // Abrir: gráfico completo (4 eixos, 8 raios, com os nomes da config) e totem; o acesso é registrado.
  expect(await viewedEvents(first.id)).toEqual([]);
  await page.locator(`a[href="/coordenacao/casas/resultados/${first.id}"]`).click();
  await expect(page.getByTestId("result-totem")).toHaveText(/^.+ \([A-Z]{2}\)$/);
  await expect(page.getByTestId("spider-chart").locator("svg text")).toHaveCount(12); // 8 polos + 4 casas nas zonas (#201)
  await expect(page.getByTestId("spider-chart").getByTestId("house-zone")).toHaveCount(4);
  // Ordem em cruz (#201): raios a1, a3, a2, a4, b1, b3, b2, b4 (os 8 primeiros textos são os polos).
  const { house1, totem1, house2, totem2 } = questionnaire.axes;
  const crossLabels = [house1.poleLabels.a, totem1.poleLabels.a, house2.poleLabels.a, totem2.poleLabels.a, house1.poleLabels.b, totem1.poleLabels.b, house2.poleLabels.b, totem2.poleLabels.b];
  expect((await page.getByTestId("spider-chart").locator("svg text").allTextContents()).slice(0, 8)).toEqual(crossLabels);
  for (const axis of Object.values(questionnaire.axes)) {
    for (const label of [axis.poleLabels.a, axis.poleLabels.b]) await expect(page.getByTestId("spider-chart").locator("svg text", { hasText: label })).toHaveCount(1);
  }
  expect(await viewedEvents(first.id)).toEqual([{ actor_id: root.id }]);
  // Resultado de quem não existe ou não tem resultado: 404.
  expect((await page.goto(`/coordenacao/casas/resultados/${plain.id}`))?.status()).toBe(404);
  expect((await page.goto("/coordenacao/casas/resultados/nao-e-um-id"))?.status()).toBe(404);

  // Fila de análise: respostas novas nunca empatam (chave sem empate, #211), então não nascem casos pelo app; a fila
  // fica para casos antigos e a correção pela coordenação, coberta nos testes de unidade e do banco.
  await page.goto("/coordenacao/casas/analise");
  await expect(page.getByTestId("case-row")).toHaveCount(0);

  // --- O gestor de SP, sem delegação: não vê as telas do questionário (nem os atalhos).
  const stateContext = await browser.newContext();
  const statePage = await stateContext.newPage();
  await signIn(statePage, state.email);
  await statePage.goto("/coordenacao");
  await expect(statePage.getByRole("link", { name: "Resultados do questionário" })).toHaveCount(0);
  expect((await statePage.goto("/coordenacao/casas/resultados"))?.status()).toBe(404);

  // --- Delegações: só a nacional. Concede ao gestor de SP.
  const stateUnit = await unitId("br.sp");
  await page.goto("/coordenacao/casas/delegacoes");
  await page.getByLabel("Gestor e unidade").selectOption({ value: `${state.id}:${stateUnit}` });
  await page.getByRole("button", { name: "Delegar" }).click();
  await expect(page.getByText("Delegação concedida.")).toBeVisible();
  const [grant] = await (await admin(`/rest/v1/questionnaire_data_grants?grantee_id=eq.${state.id}&revoked_at=is.null&select=id`)).json();
  await expect(page.locator(`input[name="concessao"][value="${grant.id}"]`)).toHaveCount(1);

  // O delegado passa a ver os atalhos de resultados e fila (não o de delegações), só o escopo dele.
  await statePage.goto("/coordenacao");
  await expect(statePage.getByRole("link", { name: "Resultados do questionário" })).toBeVisible();
  await expect(statePage.getByRole("link", { name: "Delegar acesso ao questionário" })).toHaveCount(0);
  await statePage.goto("/coordenacao/casas/resultados");
  await expect(statePage.locator(`a[href="/coordenacao/casas/resultados/${first.id}"]`)).toHaveCount(1);
  await expect(statePage.locator(`a[href="/coordenacao/casas/resultados/${outside.id}"]`)).toHaveCount(0);
  expect((await statePage.goto(`/coordenacao/casas/resultados/${outside.id}`))?.status()).toBe(404);
  expect((await statePage.goto("/coordenacao/casas/delegacoes"))?.status()).toBe(404);
  await statePage.goto(`/coordenacao/casas/resultados/${first.id}`);
  await expect(statePage.getByTestId("spider-chart").locator("svg text")).toHaveCount(12); // 8 polos + 4 casas nas zonas (#201)
  await expect(statePage.getByTestId("spider-chart").getByTestId("house-zone")).toHaveCount(4);
  expect((await viewedEvents(first.id)).map((event) => event.actor_id)).toEqual(expect.arrayContaining([root.id, state.id]));

  // Revogada a delegação, o delegado volta a receber 404.
  await page.goto("/coordenacao/casas/delegacoes");
  await page.locator(`input[name="concessao"][value="${grant.id}"]`).locator("xpath=..").getByRole("button", { name: "Revogar" }).click();
  await expect(page.getByText("Delegação revogada.")).toBeVisible();
  expect((await statePage.goto("/coordenacao/casas/resultados"))?.status()).toBe(404);

  await stateContext.close();
  await rootContext.close();
});

test("a coordenação troca a casa da pessoa dentro da trava de 4 meses e a troca fica no audit_log (ADR 0016)", async ({ browser }) => {
  test.setTimeout(120_000);
  const root = await createPerson("raiz-troca", undefined, true);
  await makeManager(root.id, "br");
  const person = await createPerson("troca");
  // A pessoa responde na tela e aceita a casa sugerida: a trava de 4 meses nasce no banco.
  const personContext = await browser.newContext();
  const personPage = await personContext.newPage();
  await signIn(personPage, person.email);
  await personPage.goto("/casa");
  await personPage.getByRole("button", { name: "Aceito e quero responder" }).click();
  for (const item of questionnaire.items) {
    await personPage.getByTestId(`scale-${allA[item.id]}`).click();
    await personPage.getByRole("button", { name: /^(Próxima|Ver o resultado)$/ }).click();
  }
  await personPage.getByRole("button", { name: "Aceitar" }).click();
  await expect(personPage.getByTestId("house-lock-notice")).toBeVisible();
  await personContext.close();
  const [before] = (await (await admin(`/rest/v1/house_members?profile_id=eq.${person.id}&left_at=is.null&select=house_key,locked_until`)).json()) as {
    house_key: string;
    locked_until: string;
  }[];
  expect(new Date(before!.locked_until).getTime()).toBeGreaterThan(Date.now() + 100 * 24 * 3600 * 1000);

  const context = await browser.newContext();
  const page = await context.newPage();
  await signIn(page, root.email);
  await page.goto(`/coordenacao/casas/resultados/${person.id}`);
  const target = before!.house_key === "atenas" ? { id: "alexandria", name: "Alexandria" } : { id: "atenas", name: "Atenas" };
  await page.getByLabel("Nova casa").selectOption({ label: target.name });
  await page.getByRole("button", { name: "Trocar a casa" }).click();
  await expect(page.getByText("Casa trocada.")).toBeVisible();
  // Casa sugerida × escolhida: o detalhe e a lista destacam a diferença, com a troca da coordenação e a data.
  await expect(page.getByTestId("result-chosen")).toHaveAttribute("data-differs", "true");
  await expect(page.getByTestId("result-chosen")).toContainText("trocada pela coordenação");
  await page.goto("/coordenacao/casas/resultados?outra=1");
  const differing = page.getByTestId("result-chosen").filter({ hasText: "trocada pela coordenação" });
  await expect(differing).toHaveCount(1);
  await expect(differing).toHaveAttribute("data-differs", "true");
  await page.goto("/coordenacao/casas/resultados");
  await expect(page.getByTestId("result-chosen").first()).toBeVisible();
  await context.close();

  const open = (await (await admin(`/rest/v1/house_members?profile_id=eq.${person.id}&left_at=is.null&select=house_key,locked_until`)).json()) as {
    house_key: string;
    locked_until: string;
  }[];
  expect(open).toEqual([{ house_key: target.id, locked_until: before!.locked_until }]);
  const audit = await (await admin(`/rest/v1/audit_log?event=eq.house_changed&target_id=eq.${person.id}&select=actor_id,reason,house_key`)).json();
  expect(audit).toEqual([{ actor_id: root.id, reason: "coordination", house_key: target.id }]);
});
