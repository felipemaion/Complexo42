import { readFileSync } from "node:fs";
import { expect, test, type Page, type Request } from "@playwright/test";
import { scoreQuestionnaire, type Answers } from "../src/modules/questionnaire/domain/score";
import type { QuestionnaireConfig } from "../src/modules/questionnaire/domain/schema";

// Escolha da casa de ponta a ponta (#76, ADR 0008 §2 e §2.1; casa nacional, ADR 0011), contra um
// Supabase local. Prova
// que as respostas do questionário não saem do aparelho: inspeciona TODAS as requisições do
// navegador, o localStorage e o sessionStorage. No CI, roda no job "E2E com banco".
// Para rodar localmente, com o banco de pé (`npm run db:start`):
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

/**
 * Pessoa nova, liberada e ativa, com perfil em SP (entra na unidade do estado). Com
 * `inRegion`, a coordenação já a pôs numa equipe da região piloto; sem, fica só no estado (a
 * casa é nacional e não exige região, ADR 0011).
 */
async function createMember(tag: string, inRegion = true): Promise<{ id: string; email: string }> {
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
  // Já aceitou o termo vigente (#11): sem a linha, o portão manda a pessoa para /termo.
  await admin("/rest/v1/consent_acceptances", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ user_id: user.id, version: "v1" }) });
  if (inRegion) {
    const [team] = await (await admin("/rest/v1/units?path=eq.br.sp.abc.equipe_1&select=id")).json();
    await admin(`/rest/v1/unit_members?profile_id=eq.${user.id}&left_at=is.null`, {
      method: "PATCH",
      body: JSON.stringify({ left_at: new Date().toISOString() }),
    });
    const placed = await admin("/rest/v1/unit_members", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ unit_id: team.id, profile_id: user.id }),
    });
    expect(placed.status).toBe(201);
  }
  return { id: user.id, email };
}

async function signIn(page: Page, email: string): Promise<void> {
  const link = await (await admin("/auth/v1/admin/generate_link", { method: "POST", body: JSON.stringify({ type: "magiclink", email }) })).json();
  const hashed = link.hashed_token ?? link.properties?.hashed_token;
  await page.goto(`/auth/confirmar?token_hash=${hashed}&type=email`);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/inicio$/);
}

type HouseRow = { join_method: string; accepted_at: string | null; consent_version: string | null; house_key: string };
async function houseRows(profileId: string): Promise<HouseRow[]> {
  const res = await admin(`/rest/v1/house_members?profile_id=eq.${profileId}&left_at=is.null&select=join_method,accepted_at,consent_version,house_key`);
  return res.json();
}
async function consents(profileId: string): Promise<{ term_version: string }[]> {
  return (await admin(`/rest/v1/questionnaire_consents?profile_id=eq.${profileId}&select=term_version`)).json();
}

async function resultRows(profileId: string): Promise<{ house_key: string; totem_enc: string; scores_enc: string; source: string }[]> {
  return (await admin(`/rest/v1/questionnaire_results?profile_id=eq.${profileId}&select=house_key,totem_enc,scores_enc,source`)).json();
}
type AnalysisRow = { status: string; resolution: string | null; answers_enc: string | null; tied_axes: string[] };
async function analysisRows(profileId: string): Promise<AnalysisRow[]> {
  return (await admin(`/rest/v1/house_analysis_requests?profile_id=eq.${profileId}&select=status,resolution,answers_enc,tied_axes`)).json();
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

test("não sabe → termo → questionário → casa sugerida → aceitar: o servidor pontua e o navegador não manda casa nem totem", async ({ page }) => {
  const member = await createMember("q");
  await signIn(page, member.email);
  await page.getByRole("link", { name: "Escolher sua casa" }).click();
  await expect(page).toHaveURL(/\/casa$/);
  const requests = recordRequests(page);

  await page.getByRole("button", { name: "Ainda não" }).click();
  await expect(page.getByTestId("consent-term")).toHaveText(questionnaire.consentTerm);
  await page.getByRole("button", { name: "Aceito e quero responder" }).click();
  // A chave (eixos, desempates, mapa das casas, letras do totem) não vai para o navegador (ADR 0014 §1).
  const html = await page.content();
  for (const secret of ["tieBreakItems", "houseByPoles", "itemIds", "letters"]) expect(html).not.toContain(secret);

  const total = questionnaire.items.length;
  const answers: Record<string, number> = {};
  // Intensidades variadas, todas do lado "a" (negativas): resultado conclusivo (casa 1 e o totem do exemplo).
  const pick = (i: number) => [-3, -2, -1][i % 3]!;
  const circle = (value: number) => page.getByTestId(`scale-${value}`);
  const next = page.getByRole("button", { name: /^(Próxima|Ver o resultado)$/ });
  const before = requests.length;
  for (let i = 0; i < total; i++) {
    const item = questionnaire.items[i]!;
    // Uma pergunta por tela, com o progresso e o voltar sempre à vista.
    await expect(page.getByTestId("question-progress")).toHaveText(`${i + 1} de ${total}`);
    await expect(page.getByRole("heading", { level: 2 })).toHaveText(item.text);
    await expect(page.getByRole("button", { name: /Voltar/ })).toBeVisible();
    // Seis círculos num grupo de rádio, NENHUM marcado de início, e "próxima" só vale com resposta.
    await expect(page.getByRole("radiogroup")).toBeVisible();
    await expect(page.getByRole("radio")).toHaveCount(6);
    await expect(page.locator('[role="radio"][aria-checked="true"]')).toHaveCount(0);
    await expect(next).toBeDisabled();
    if (i === 0) {
      // Teclado: as setas movem e marcam; sem círculo marcado, a primeira seta marca o seguinte.
      await circle(-3).focus();
      await page.keyboard.press("ArrowRight");
      await expect(circle(-2)).toHaveAttribute("aria-checked", "true");
      // Abaixo dos círculos, a frase composta da posição (intensidade + texto da alternativa), com maiúscula
      // e pontuação final; o mesmo texto é o nome acessível do círculo, e o "a)"/"b)" não aparece.
      const first = questionnaire.items[0]!;
      const sentence = `Na maior parte das vezes: ${first.a.text.trim().replace(/[;,:]$/, "").replace(/([^.!?…])$/, "$1.")}`;
      await expect(page.getByTestId("scale-reading")).toHaveText(sentence);
      await expect(circle(-2)).toHaveAttribute("aria-label", sentence);
      await expect(page.getByText(/^\s*[ab]\)/)).toHaveCount(0);
      // Passar o mouse mostra a frase do outro círculo; sair volta à marcada.
      await circle(1).hover();
      await expect(page.getByTestId("scale-reading")).toHaveText(/^Um pouco mais: /);
      await page.mouse.move(0, 0);
      await expect(page.getByTestId("scale-reading")).toHaveText(sentence);
    }
    if (i === 1) {
      // Voltar mantém a resposta anterior marcada e deixa trocar.
      await page.getByRole("button", { name: /Voltar/ }).click();
      await expect(page.getByTestId("question-progress")).toHaveText(`1 de ${total}`);
      await expect(circle(pick(0))).toHaveAttribute("aria-checked", "true");
      // Já respondida, "próxima" volta à pergunta 2 (que continua sem resposta).
      await next.click();
      await expect(page.getByTestId("question-progress")).toHaveText(`2 de ${total}`);
    }
    // Enquanto a pessoa responde, o navegador não faz requisição nenhuma; a primeira sai ao
    // concluir a última pergunta (o resultado vai ao servidor).
    if (i === total - 1) expect(requests.slice(before).map((r) => r.url())).toEqual([]);
    await circle(pick(i)).click();
    await expect(circle(pick(i))).toHaveAttribute("aria-checked", "true");
    await next.click();
    answers[item.id] = pick(i);
  }

  const result = scoreQuestionnaire(questionnaire, answers as Answers);
  // O perfil mostra só os eixos da casa (4 raios); o totem e as notas dos outros eixos não aparecem.
  await expect(page.getByTestId("spider-chart")).toBeVisible();
  if (result.status !== "ok") throw new Error("o exemplo deveria dar resultado conclusivo");
  const expected = result.houseId;
  await expect(page.getByText("Sugerimos esta casa para você")).toBeVisible();
  await expect(page.getByRole("button", { name: "Escolher outra casa" })).toBeVisible();
  const chart = page.getByTestId("spider-chart");
  await expect(chart.locator("svg text")).toHaveCount(4);
  for (const label of [questionnaire.axes.house1.poleLabels.a, questionnaire.axes.house1.poleLabels.b, questionnaire.axes.house2.poleLabels.a, questionnaire.axes.house2.poleLabels.b]) {
    await expect(chart.locator("svg text", { hasText: label })).toHaveCount(1);
  }
  for (const hidden of [questionnaire.axes.totem1.poleLabels.a, questionnaire.axes.totem2.poleLabels.b, questionnaire.axes.totem1.label]) {
    await expect(page.getByText(hidden)).toHaveCount(0);
  }
  await expectNoStorage(page);
  await page.getByRole("button", { name: "Aceitar" }).click();
  await expect(page.getByText("Sua casa", { exact: true })).toBeVisible();

  // Só três chamadas ao servidor: a versão do termo, as respostas (o servidor pontua) e a casa com
  // a forma de entrada. O navegador nunca manda casa nem totem do resultado.
  expect(actionBodies(requests)).toEqual([
    [{ termVersion: questionnaire.consentTermVersion }],
    [{ answers }],
    [{ houseId: expected, joinMethod: "questionnaire" }],
  ]);
  // Fora do envio das respostas, nenhuma requisição (URL, cabeçalho ou corpo) leva um id de item
  // ou o texto de uma resposta; e nenhuma leva o totem.
  const leaks = questionnaire.items.flatMap((item) => [item.id, item.a.text, item.b.text]);
  for (const r of requests) {
    const sent = `${r.url()} ${JSON.stringify(r.headers())} ${r.postData() ?? ""}`;
    expect(sent).not.toContain(result.totem);
    if (JSON.stringify(actionBodies([r])) === JSON.stringify([[{ answers }]])) continue;
    for (const leak of leaks) expect(sent, r.url()).not.toContain(leak);
  }
  await expectNoStorage(page);
  expect(page.url()).toMatch(/\/casa$/);

  expect(await houseRows(member.id)).toEqual([
    {
      join_method: "questionnaire",
      accepted_at: expect.any(String),
      consent_version: questionnaire.consentTermVersion,
      house_key: expected,
    },
  ]);
  expect(await consents(member.id)).toEqual([{ term_version: questionnaire.consentTermVersion }]);
  // O totem fica CIFRADO no banco (ADR 0003: v<n>.<iv>.<ct>), nunca em texto puro.
  const [stored] = await resultRows(member.id);
  expect(stored).toMatchObject({ house_key: expected, source: "questionnaire" });
  expect(stored!.totem_enc).toMatch(/^v[1-9][0-9]{0,2}\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22,}$/);
  expect(stored!.totem_enc).not.toContain(result.totem);
  // As notas dos eixos também ficam cifradas (ADR 0014), nunca em JSON legível.
  expect(stored!.scores_enc).toMatch(/^v[1-9][0-9]{0,2}\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22,}$/);
  expect(stored!.scores_enc).not.toContain("house1");
  expect(await analysisRows(member.id)).toEqual([]);
  // O totem é interno: não aparece na tela da casa.
  await expect(page.getByText(result.totem, { exact: true })).toHaveCount(0);

  // Recarregar mostra a casa aceita, não o fluxo de novo.
  await page.reload();
  await expect(page.getByText("Sua casa", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Ainda não" })).toHaveCount(0);
});

test("resultado inconclusivo: pedido de análise com as respostas, sem casa; escolher direto apaga as respostas", async ({ page }) => {
  const member = await createMember("i");
  await signIn(page, member.email);
  await page.goto("/casa");
  const requests = recordRequests(page);

  await page.getByRole("button", { name: "Ainda não" }).click();
  await page.getByRole("button", { name: "Aceito e quero responder" }).click();
  // Notas 0 nos eixos 2, 3 e 4 (sem desempate no exemplo): eixo 2 com -2, -1 e 3; eixos 3 e 4 com -3 e 3.
  // O eixo 1 fica conclusivo (tudo "muito a"). Resultado inconclusivo.
  const tiedAnswers: Record<string, number> = {
    q01: -3, q05: -3, q09: -3,
    q02: -2, q06: -1, q10: 3,
    q03: -3, q07: 3,
    q04: -3, q08: 3,
  };
  const answers: Record<string, number> = {};
  for (const item of questionnaire.items) {
    const value = tiedAnswers[item.id]!;
    answers[item.id] = value;
    await page.getByTestId(`scale-${value}`).click();
    await page.getByRole("button", { name: /^(Próxima|Ver o resultado)$/ }).click();
  }
  await expect(page.getByRole("heading", { name: "Vamos analisar o seu resultado" })).toBeVisible();
  await expect(page.getByText("Sugerimos esta casa para você")).toHaveCount(0);
  await expectNoStorage(page);

  // O navegador manda só as respostas; o servidor decide que é inconclusivo. Nenhuma casa foi atribuída.
  const bodies = actionBodies(requests);
  expect(bodies).toHaveLength(2);
  expect(bodies[1]).toEqual([{ answers }]);
  expect(await houseRows(member.id)).toEqual([]);
  expect(await resultRows(member.id)).toEqual([]);
  const [open] = await analysisRows(member.id);
  expect(open).toMatchObject({ status: "open", resolution: null });
  // As respostas ficam cifradas no banco, nunca em JSON legível.
  expect(open!.answers_enc).toMatch(/^v[1-9][0-9]{0,2}\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22,}$/);
  expect(open!.answers_enc).not.toContain("q01");

  // A pessoa pode escolher a casa direto; o pedido fecha e as respostas somem.
  await page.getByRole("button", { name: "Escolher a casa direto" }).click();
  await page.getByRole("button", { name: "[PREENCHER] Atividade exemplo 1A" }).click();
  await page.getByRole("button", { name: "Aceitar" }).click();
  await expect(page.getByText("Sua casa", { exact: true })).toBeVisible();
  expect(await analysisRows(member.id)).toEqual([
    { status: "resolved", resolution: "self", answers_enc: null, tied_axes: ["house2", "totem1", "totem2"] },
  ]);
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
    { join_method: "self", accepted_at: expect.any(String), consent_version: null, house_key: "casa-exemplo-3" },
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

test("quem ainda está só no estado (sem região) escolhe a casa (ADR 0011)", async ({ page }) => {
  const member = await createMember("e", false);
  await signIn(page, member.email);
  await page.goto("/casa");
  await page.getByRole("button", { name: "Sim, já sei" }).click();
  await page.getByRole("button", { name: "[PREENCHER] Atividade exemplo 1A" }).click();
  await page.getByRole("button", { name: "Aceitar" }).click();
  await expect(page.getByText("Sua casa", { exact: true })).toBeVisible();
  await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
  expect(await houseRows(member.id)).toEqual([
    { join_method: "self", accepted_at: expect.any(String), consent_version: null, house_key: "casa-exemplo-1" },
  ]);
});

test("tirada da casa pela coordenação, a pessoa vê o motivo e não volta sozinha", async ({ page }) => {
  const member = await createMember("x");
  await signIn(page, member.email);
  await page.goto("/casa");
  await page.getByRole("button", { name: "Sim, já sei" }).click();
  await page.getByRole("button", { name: "[PREENCHER] Atividade exemplo 1A" }).click();
  await page.getByRole("button", { name: "Aceitar" }).click();
  await expect(page.getByText("Sua casa", { exact: true })).toBeVisible();
  // Encerrado fora do JWT da pessoa (ended_by fica nulo, como numa operação da coordenação).
  const ended = await admin(`/rest/v1/house_members?profile_id=eq.${member.id}&left_at=is.null`, {
    method: "PATCH",
    body: JSON.stringify({ left_at: new Date().toISOString() }),
  });
  expect(ended.ok).toBe(true);
  await page.goto("/casa");
  await page.getByRole("button", { name: "Sim, já sei" }).click();
  await page.getByRole("button", { name: "[PREENCHER] Atividade exemplo 2A" }).click();
  await page.getByRole("button", { name: "Aceitar" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toHaveText(/A coordenação tirou você da sua casa/);
  expect(await houseRows(member.id)).toEqual([]);
});
