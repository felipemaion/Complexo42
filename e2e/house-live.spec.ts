import { readFileSync } from "node:fs";
import { expect, test, type Page, type Request } from "@playwright/test";
import { scoreQuestionnaire, type Answers } from "../src/modules/questionnaire/domain/score";
import type { QuestionnaireConfig } from "../src/modules/questionnaire/domain/schema";

// Escolha da casa de ponta a ponta (#76, ADR 0008 §2 e §2.1), contra um Supabase local. Prova
// que as respostas do questionário não saem do aparelho: inspeciona TODAS as requisições do
// navegador, o localStorage e o sessionStorage. Não roda no CI (o job de E2E não sobe o
// Supabase). Para rodar, com o banco de pé (`npm run db:start`):
//   E2E_LIVE_SUPABASE_URL=<API_URL> E2E_LIVE_ANON_KEY=<ANON_KEY> \
//   E2E_LIVE_SERVICE_ROLE_KEY=<SERVICE_ROLE_KEY> npm run test:e2e -- house-live
// A chave service_role fica só neste processo de teste (cria a pessoa e confere o banco); o
// app e o navegador nunca a recebem (R6).
const API = process.env.E2E_LIVE_SUPABASE_URL;
const SERVICE = process.env.E2E_LIVE_SERVICE_ROLE_KEY;
test.skip(!API || !SERVICE, "precisa do Supabase local e da chave service_role");

// O exemplo de config/ (sem QUESTIONNAIRE_PATH, é o que o app carrega).
const questionnaire = JSON.parse(readFileSync("config/questionnaire.example.json", "utf8")) as QuestionnaireConfig;
const SAO_PAULO = 3550308;

const admin = (path: string, init: RequestInit = {}) =>
  fetch(`${API}${path}`, {
    ...init,
    headers: { apikey: SERVICE!, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json", ...init.headers },
  });

/** Pessoa nova, liberada e ativa, com perfil em SP (entra na unidade do estado). */
async function createMember(tag: string): Promise<{ id: string; email: string }> {
  const email = `casa.${tag}.${Date.now()}@exemplo.org`;
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
  return { id: user.id, email };
}

async function signIn(page: Page, email: string): Promise<void> {
  const link = await (await admin("/auth/v1/admin/generate_link", { method: "POST", body: JSON.stringify({ type: "magiclink", email }) })).json();
  const hashed = link.hashed_token ?? link.properties?.hashed_token;
  await page.goto(`/auth/confirmar?token_hash=${hashed}&type=email`);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/inicio$/);
}

type HouseRow = { join_method: string; accepted_at: string | null; units: { slug: string } };
async function houseRows(profileId: string): Promise<HouseRow[]> {
  const res = await admin(`/rest/v1/unit_members?profile_id=eq.${profileId}&axis=eq.house&left_at=is.null&select=join_method,accepted_at,units(slug)`);
  return res.json();
}
async function consents(profileId: string): Promise<{ term_version: string }[]> {
  return (await admin(`/rest/v1/questionnaire_consents?profile_id=eq.${profileId}&select=term_version`)).json();
}

/** Grava toda requisição do navegador. As server actions vão com o cabeçalho `Next-Action`. */
function recordRequests(page: Page): Request[] {
  const all: Request[] = [];
  page.on("request", (r) => all.push(r));
  return all;
}
const actionBodies = (requests: Request[]) =>
  requests.filter((r) => r.headers()["next-action"]).map((r) => JSON.parse(r.postData() ?? "null") as unknown);

async function expectNoStorage(page: Page): Promise<void> {
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
}

test.describe.configure({ mode: "serial" });

test("não sabe → termo → questionário → casa sugerida → aceitar: só a casa sai do aparelho", async ({ page }) => {
  const member = await createMember("q");
  await signIn(page, member.email);
  await page.getByRole("link", { name: "Escolher sua casa" }).click();
  await expect(page).toHaveURL(/\/casa$/);
  const requests = recordRequests(page);

  await page.getByRole("button", { name: "Ainda não" }).click();
  await expect(page.getByTestId("consent-term")).toHaveText(questionnaire.consentTerm);
  await page.getByRole("button", { name: "Aceito e quero responder" }).click();

  const total = questionnaire.items.length;
  const answers: Record<string, "a" | "b" | "both"> = {};
  const pick = (i: number) => (["a", "b", "both"] as const)[i % 3]!;
  const button = (i: number) => {
    const item = questionnaire.items[i]!;
    const choice = pick(i);
    return choice === "both"
      ? page.getByRole("button", { name: "as duas", exact: true })
      : page.getByRole("button").filter({ hasText: item[choice].text });
  };
  const before = requests.length;
  for (let i = 0; i < total; i++) {
    const item = questionnaire.items[i]!;
    // Uma pergunta por tela, com o progresso e o voltar sempre à vista.
    await expect(page.getByTestId("question-progress")).toHaveText(`${i + 1} de ${total}`);
    await expect(page.getByRole("heading", { level: 2 })).toHaveText(item.text);
    await expect(page.getByRole("button", { name: /Voltar/ })).toBeVisible();
    expect((await page.getByRole("button", { name: "as duas", exact: true }).boundingBox())?.height).toBeGreaterThanOrEqual(56);
    if (i === 1) {
      // Voltar mantém a resposta anterior marcada e deixa trocar.
      await page.getByRole("button", { name: /Voltar/ }).click();
      await expect(page.getByTestId("question-progress")).toHaveText(`1 de ${total}`);
      await expect(button(0)).toHaveAttribute("aria-pressed", "true");
      await button(0).click();
    }
    await button(i).click();
    answers[item.id] = pick(i);
  }
  // Enquanto a pessoa responde, o navegador não faz requisição nenhuma.
  expect(requests.slice(before).map((r) => r.url())).toEqual([]);

  const expected = scoreQuestionnaire(questionnaire, answers as Answers).houseId;
  await expect(page.getByText("Sugerimos esta casa para você")).toBeVisible();
  await expect(page.getByRole("button", { name: "Escolher outra casa" })).toBeVisible();
  await expectNoStorage(page);
  await page.getByRole("button", { name: "Aceitar" }).click();
  await expect(page.getByText("Sua casa", { exact: true })).toBeVisible();

  // Só duas chamadas ao servidor: a versão do termo e a casa com a forma de entrada.
  expect(actionBodies(requests)).toEqual([
    [{ termVersion: questionnaire.consentTermVersion }],
    [{ houseId: expected, joinMethod: "questionnaire" }],
  ]);
  // Nenhuma requisição (URL, cabeçalho ou corpo) leva um id de item ou o texto de uma resposta.
  const leaks = questionnaire.items.flatMap((item) => [item.id, item.a.text, item.b.text]);
  for (const r of requests) {
    const sent = `${r.url()} ${JSON.stringify(r.headers())} ${r.postData() ?? ""}`;
    for (const leak of leaks) expect(sent, r.url()).not.toContain(leak);
    expect(sent).not.toContain('"both"');
  }
  await expectNoStorage(page);
  expect(page.url()).toMatch(/\/casa$/);

  expect(await houseRows(member.id)).toEqual([
    { join_method: "questionnaire", accepted_at: expect.any(String), units: { slug: expected.replaceAll("-", "_") } },
  ]);
  expect(await consents(member.id)).toEqual([{ term_version: questionnaire.consentTermVersion }]);

  // Recarregar mostra a casa aceita, não o fluxo de novo.
  await page.reload();
  await expect(page.getByText("Sua casa", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Ainda não" })).toHaveCount(0);
});

test("sabe → atividade → apresentação → escolher outra → aceitar (self), sem termo", async ({ page }) => {
  const member = await createMember("s");
  await signIn(page, member.email);
  await page.goto("/casa");
  const requests = recordRequests(page);

  await page.getByRole("button", { name: "Sim, já sei" }).click();
  await page.getByRole("button", { name: "[PREENCHER] Atividade exemplo 2A" }).click();
  await expect(page.getByText("Conheça a casa")).toBeVisible();
  await expect(page.getByTestId("house-name")).toHaveText("Casa Exemplo Dois");
  await page.getByRole("button", { name: "Escolher outra casa" }).click();
  await page.getByRole("button", { name: "[PREENCHER] Atividade exemplo 3A" }).click();
  await expect(page.getByTestId("house-name")).toHaveText("Casa Exemplo Três");
  await page.getByRole("button", { name: "Aceitar" }).click();
  await expect(page.getByText("Sua casa", { exact: true })).toBeVisible();

  expect(actionBodies(requests)).toEqual([[{ houseId: "casa-exemplo-3", joinMethod: "self" }]]);
  expect(await houseRows(member.id)).toEqual([
    { join_method: "self", accepted_at: expect.any(String), units: { slug: "casa_exemplo_3" } },
  ]);
  expect(await consents(member.id)).toEqual([]);
  await expectNoStorage(page);
});

test("recusar o termo leva à escolha direta e não grava aceite", async ({ page }) => {
  const member = await createMember("r");
  await signIn(page, member.email);
  await page.goto("/casa");
  const requests = recordRequests(page);

  await page.getByRole("button", { name: "Ainda não" }).click();
  await page.getByRole("button", { name: "Não aceito, prefiro escolher a casa" }).click();
  await expect(page.getByRole("heading", { name: "O que você quer fazer?" })).toBeVisible();
  await page.getByRole("button", { name: "[PREENCHER] Atividade exemplo 1A" }).click();
  await page.getByRole("button", { name: "Aceitar" }).click();
  await expect(page.getByText("Sua casa", { exact: true })).toBeVisible();

  expect(actionBodies(requests)).toEqual([[{ houseId: "casa-exemplo-1", joinMethod: "self" }]]);
  expect(await consents(member.id)).toEqual([]);
  expect((await houseRows(member.id))[0]?.join_method).toBe("self");
});

test("quem ainda não está ativo vê o motivo e nada é gravado", async ({ page }) => {
  const member = await createMember("p");
  await signIn(page, member.email);
  // Suspensa depois do login: o banco recusa a escolha (accept_house exige perfil ativo).
  await admin(`/rest/v1/profiles?id=eq.${member.id}`, { method: "PATCH", body: JSON.stringify({ status: "suspended" }) });
  await page.goto("/casa");
  await page.getByRole("button", { name: "Sim, já sei" }).click();
  await page.getByRole("button", { name: "[PREENCHER] Atividade exemplo 1A" }).click();
  await page.getByRole("button", { name: "Aceitar" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toHaveText("Complete o seu cadastro antes de escolher a casa.");
  expect(await houseRows(member.id)).toEqual([]);
});
