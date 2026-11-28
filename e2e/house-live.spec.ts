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

/**
 * O totem é do membro (#303, ADR 0014 revisão de 28/11): na /inicio aparece a medalha com o nome do totem, lido e decifrado no
 * servidor. As notas dos eixos, as respostas e o texto cifrado nunca vão à tela (nem ao HTML das telas da pessoa).
 */
async function expectTotemAsMedalOnly(page: Page, totemCode: string) {
  const name = questionnaire.totemLabels[totemCode]!.name;
  await page.goto("/inicio");
  const medal = page.getByTestId("totem-medal");
  await expect(medal).toBeVisible();
  await expect(medal).toHaveAttribute("alt", name);
  const sources = [await page.content(), ...(await Promise.all(["/casa", "/inicio"].map(async (path) => (await page.request.get(path)).text())))];
  for (const source of sources) {
    for (const internal of ["totem_enc", "scores_enc", "answers_enc"]) expect(source).not.toContain(internal);
  }
}
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
  // Quem ainda não tem casa cai em /casa (ADR 0017); quem já tem, em /inicio.
  await expect(page).toHaveURL(/\/(inicio|casa)$/);
}

type HouseRow = { join_method: string; accepted_at: string | null; consent_version: string | null; house_key: string };
async function houseRows(profileId: string): Promise<HouseRow[]> {
  const res = await admin(`/rest/v1/house_members?profile_id=eq.${profileId}&left_at=is.null&select=join_method,accepted_at,consent_version,house_key`);
  return res.json();
}
async function consents(profileId: string): Promise<{ term_version: string }[]> {
  return (await admin(`/rest/v1/questionnaire_consents?profile_id=eq.${profileId}&select=term_version`)).json();
}

async function resultRows(profileId: string): Promise<{ house_key: string; totem_enc: string; scores_enc: string; answers_enc: string; source: string }[]> {
  return (await admin(`/rest/v1/questionnaire_results?profile_id=eq.${profileId}&select=house_key,totem_enc,scores_enc,answers_enc,source`)).json();
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
  await page.goto("/casa");
  await expect(page).toHaveURL(/\/casa$/);
  // O HTML e o payload RSC de /casa, antes de responder, não trazem a chave nem o mapa das casas (ADR 0014 §1).
  const pageSource = await (await page.request.get("/casa")).text();
  for (const secret of ["houseByPoles", "itemIds", "letters", "totemLabels"]) expect(pageSource).not.toContain(secret);
  const requests = recordRequests(page);

  await expect(page.getByTestId("consent-term")).toHaveText(questionnaire.consentTerm);
  // Sem trava de 4 meses (ADR 0016): nenhum aviso de prazo junto ao botão.
  await expect(page.getByTestId("consent-lock-notice")).toHaveCount(0);
  // Respostas guardadas cifradas: aviso de tela logo depois, ainda antes do botão de aceitar e fora do termo.
  await expect(page.getByTestId("consent-stored-notice")).toContainText("guardadas de forma cifrada");
  await expect(page.getByTestId("consent-term")).not.toContainText("guardadas de forma cifrada");
  await page.getByRole("button", { name: "Aceito e quero responder" }).click();
  // A chave (eixos, mapa das casas, letras do totem) não vai para o navegador (ADR 0014 §1).
  const html = await page.content();
  for (const secret of ["houseByPoles", "itemIds", "letters"]) expect(html).not.toContain(secret);

  const total = questionnaire.items.length;
  const answers: Record<string, number> = {};
  // Intensidades variadas, todas do lado "a" (negativas): resultado conclusivo (casa 1 e o totem do exemplo).
  const pick = (i: number) => [-5, -3, -1][i % 3]!;
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
      await circle(-5).focus();
      await page.keyboard.press("ArrowRight");
      await expect(circle(-3)).toHaveAttribute("aria-checked", "true");
      // Abaixo dos círculos, a frase composta da posição (intensidade + texto da alternativa), com maiúscula
      // e pontuação final; o mesmo texto é o nome acessível do círculo, e o "a)"/"b)" não aparece.
      const first = questionnaire.items[0]!;
      const sentence = `Na maior parte das vezes: ${first.a.text.trim().replace(/[;,:]$/, "").replace(/([^.!?…])$/, "$1.")}`;
      await expect(page.getByTestId("scale-reading")).toHaveText(sentence);
      await expect(circle(-3)).toHaveAttribute("aria-label", sentence);
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
  // 4 nomes de polo + 4 nomes de casa nas zonas coloridas (#201); a casa sugerida vem destacada na legenda.
  await expect(chart.locator("svg text")).toHaveCount(8);
  await expect(chart.getByTestId("house-zone")).toHaveCount(4);
  await expect(chart.locator('[data-testid="house-legend"] [data-current="true"]')).toContainText("sua casa");
  for (const label of [questionnaire.axes.house1.poleLabels.a, questionnaire.axes.house1.poleLabels.b, questionnaire.axes.house2.poleLabels.a, questionnaire.axes.house2.poleLabels.b]) {
    await expect(chart.locator("svg text", { hasText: label })).toHaveCount(1);
  }
  for (const hidden of [questionnaire.axes.totem1.poleLabels.a, questionnaire.axes.totem2.poleLabels.b, questionnaire.axes.totem1.label]) {
    await expect(page.getByText(hidden)).toHaveCount(0);
  }
  await expectNoStorage(page);
  await page.getByRole("button", { name: "Aceitar" }).click();
  await expect(page.getByRole("heading", { name: "Sua casa", exact: true })).toBeVisible();

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
  // As últimas respostas ficam guardadas cifradas (ADR 0014, #256), nunca em JSON legível.
  expect(stored!.answers_enc).toMatch(/^v[1-9][0-9]{0,2}\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22,}$/);
  expect(stored!.answers_enc).not.toContain(questionnaire.items[0]!.id);
  expect(await analysisRows(member.id)).toEqual([]);
  // O totem é visível ao membro (#303): a medalha aparece na página inicial, com o nome; o resto segue interno.
  await expectTotemAsMedalOnly(page, result.totem);

  // Recarregar mostra a casa aceita, não o fluxo de novo.
  await page.reload();
  await expect(page.getByRole("heading", { name: "Sua casa", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Aceito e quero responder" })).toHaveCount(0);
});

test("escolher outra casa depois do questionário: compara as casas antes de confirmar (#240)", async ({ page }) => {
  const member = await createMember("cmp");
  await signIn(page, member.email);
  await page.goto("/casa");
  const requests = recordRequests(page);
  await page.getByRole("button", { name: "Aceito e quero responder" }).click();
  const answers: Record<string, number> = {};
  for (const item of questionnaire.items) {
    answers[item.id] = -5;
    await page.getByTestId("scale--5").click();
    await page.getByRole("button", { name: /^(Próxima|Ver o resultado)$/ }).click();
  }
  await expect(page.getByText("Sugerimos esta casa para você")).toBeVisible();
  const scored = scoreQuestionnaire(questionnaire, answers as Answers);
  const suggested = scored.houseId;
  // Antes de comparar, as frases de expectativa (config) não estão na página: só o servidor as conhece.
  expect(await page.content()).not.toContain("espera-se");

  await page.getByRole("button", { name: "Escolher outra casa" }).click();
  await expect(page.getByTestId("compare-houses")).toBeVisible();
  // As quatro casas (escudo, nome, descrição) e a sugerida em destaque.
  await expect(page.locator('[data-testid^="compare-house-"]')).toHaveCount(4);
  await expect(page.getByTestId("suggested-badge")).toHaveCount(1);
  await expect(page.getByTestId(`compare-house-${suggested}`)).toHaveAttribute("data-suggested", "true");

  // Casa do polo oposto nos dois eixos: todas as respostas "muito a" contradizem o que ela espera.
  const opposite = questionnaire.houseByPoles.bb;
  // O nome da casa é o alt do escudo do cartão (o config/instance não carrega sob o Playwright: usa server-only). O texto
  // visível do cartão vai em MAIÚSCULAS por CSS, então innerText não serve.
  const oppositeName = (await page.getByTestId(`compare-house-${opposite}`).getByRole("img").getAttribute("alt"))!;
  await page.getByTestId(`compare-house-${opposite}`).click();
  const houseItems = questionnaire.axes.house1.itemIds.length + questionnaire.axes.house2.itemIds.length;
  await expect(page.getByTestId("expectation")).toHaveCount(houseItems);
  await expect(page.getByTestId("expectation").first()).toContainText("Totalmente");
  await expect(page.getByTestId("expectation").first()).toContainText("espera-se");
  // Poucos membros com resultado: sem o perfil médio, só o aviso; e nada do totem aparece.
  await expect(page.getByTestId("few-members")).toBeVisible();
  await expect(page.getByTestId("compare-profile")).toHaveCount(0);
  for (const hidden of [questionnaire.axes.totem1.poleLabels.a, questionnaire.axes.totem2.poleLabels.b, questionnaire.axes.totem1.label]) {
    await expect(page.getByText(hidden)).toHaveCount(0);
  }
  // O que o navegador recebeu da comparação não tem id de pessoa, nota cifrada nem totem.
  const bodies = actionBodies(requests);
  // A comparação não manda respostas: manda só a casa e o token selado pelo servidor (cifrado, que o navegador não lê).
  expect(bodies).toContainEqual([{ houseId: opposite, token: expect.stringMatching(/^v\d+\./) }]);
  expect(JSON.stringify(bodies.at(-1))).not.toContain("answers");

  // Confirmar leva à apresentação da casa (escolha direta); aceitar grava como self.
  await page.getByRole("button", { name: "Escolher esta casa" }).click();
  await expect(page.getByTestId("house-name")).toHaveText(oppositeName);
  await page.getByRole("button", { name: "Aceitar" }).click();
  await expect(page.getByRole("heading", { name: "Sua casa", exact: true })).toBeVisible();
  expect(await houseRows(member.id)).toEqual([expect.objectContaining({ join_method: "self", house_key: opposite })]);
  await expectTotemAsMedalOnly(page, scored.totem);
});

// Troca de casa depois da trava (#268): a MESMA tela de comparação do "Escolher outra casa", montada no servidor a partir do que
// está guardado. Com respostas guardadas a expectativa é por pergunta; sem elas (respondeu antes), pelo eixo.
// A janela de transferência é um estado único do banco (ADR 0016): cada teste põe o que precisa, direto no banco, e a deixa fechada.
async function setWindow(open: boolean) {
  const r = await admin("/rest/v1/house_transfer_window?singleton=eq.true", { method: "PATCH", body: JSON.stringify({ is_open: open }) });
  expect(r.ok).toBe(true);
}

test.afterEach(async () => {
  await setWindow(false);
});

async function answerAndAccept(page: Page) {
  await page.goto("/casa");
  await page.getByRole("button", { name: "Aceito e quero responder" }).click();
  for (let index = 0; index < questionnaire.items.length; index += 1) {
    await page.getByTestId("scale--5").click();
    await page.getByRole("button", { name: /^(Próxima|Ver o resultado)$/ }).click();
  }
  await expect(page.getByText("Sugerimos esta casa para você")).toBeVisible();
  await page.getByRole("button", { name: "Aceitar" }).click();
  await expect(page.getByRole("heading", { name: "Sua casa", exact: true })).toBeVisible();
  // Janela de transferência aberta pela coordenação nacional: só então o link de troca aparece.
  await setWindow(true);
  await page.goto("/casa");
  await page.getByTestId("change-house-link").click();
}

test("trocar de casa com a janela aberta: tela de comparação com a casa atual e expectativas por pergunta (#268)", async ({ page }) => {
  const member = await createMember("trc");
  await signIn(page, member.email);
  await answerAndAccept(page);
  const requests = recordRequests(page);
  await expect(page.getByTestId("compare-houses")).toBeVisible();
  await expect(page.locator('[data-testid^="compare-house-"]')).toHaveCount(4);
  await expect(page.getByTestId("current-badge")).toHaveCount(1);
  await expect(page.getByTestId("suggested-badge")).toHaveCount(1);
  // Nada do totem na tela; as frases de expectativa não estão na página antes de comparar.
  expect(await page.content()).not.toContain("[EXEMPLO] Nesta casa");
  const current = page.locator('[data-testid^="compare-house-"]', { has: page.getByTestId("current-badge") });
  const other = page.locator('[data-testid^="compare-house-"]', { hasNot: page.getByTestId("current-badge") }).first();
  // A casa atual não se confirma.
  await current.click();
  await expect(page.getByTestId("compare-confirm")).toBeDisabled();
  await other.click();
  await expect(page.getByTestId("expectations")).toBeVisible();
  await expect(page.getByTestId("compare-confirm")).toBeEnabled();
  // A comparação manda a casa e o token selado, nunca respostas.
  const compareBodies = actionBodies(requests).filter((body) => JSON.stringify(body).includes("token"));
  expect(compareBodies.length).toBeGreaterThan(0);
  expect(JSON.stringify(compareBodies)).not.toContain("answers");
  await page.getByTestId("compare-confirm").click();
  // Sem trava de 4 meses (ADR 0016): a confirmação não traz aviso de prazo.
  await expect(page.getByTestId("change-lock-notice")).toHaveCount(0);
  await page.getByRole("button", { name: "Aceitar" }).click();
  await expect(page.getByRole("heading", { name: "Sua casa", exact: true })).toBeVisible();
  const rows = await houseRows(member.id);
  expect(rows).toHaveLength(1);
  expect(rows[0]?.join_method).toBe("self");
});

test("janela fechada: sem link de troca nem data; abrir e fechar mostram e tiram o link (ADR 0016)", async ({ page }) => {
  const member = await createMember("jan");
  await setWindow(false);
  await signIn(page, member.email);
  await page.goto("/casa");
  await page.getByRole("button", { name: "Aceito e quero responder" }).click();
  for (let index = 0; index < questionnaire.items.length; index += 1) {
    await page.getByTestId("scale--5").click();
    await page.getByRole("button", { name: /^(Próxima|Ver o resultado)$/ }).click();
  }
  await page.getByRole("button", { name: "Aceitar" }).click();
  await expect(page.getByRole("heading", { name: "Sua casa", exact: true })).toBeVisible();
  await expect(page.getByTestId("change-house-link")).toHaveCount(0);
  await expect(page.getByTestId("house-lock-notice")).toHaveCount(0);
  expect(await page.content()).not.toMatch(/\d{2}\/\d{2}\/\d{4}/);
  await page.goto("/inicio");
  await expect(page.getByTestId("house-lock-notice")).toHaveCount(0);
  await setWindow(true);
  await page.goto("/casa");
  await expect(page.getByTestId("change-house-link")).toBeVisible();
  await setWindow(false);
  await page.goto("/casa");
  await expect(page.getByTestId("change-house-link")).toHaveCount(0);
});

test("trocar de casa sem respostas guardadas (respondeu antes): o que se espera vem por eixo (#268)", async ({ page }) => {
  const member = await createMember("trs");
  await signIn(page, member.email);
  await page.goto("/casa");
  await page.getByRole("button", { name: "Aceito e quero responder" }).click();
  for (let index = 0; index < questionnaire.items.length; index += 1) {
    await page.getByTestId("scale--5").click();
    await page.getByRole("button", { name: /^(Próxima|Ver o resultado)$/ }).click();
  }
  await page.getByRole("button", { name: "Aceitar" }).click();
  await expect(page.getByRole("heading", { name: "Sua casa", exact: true })).toBeVisible();
  // Como quem respondeu antes de guardarmos as respostas: o resultado fica, as respostas não.
  expect((await admin(`/rest/v1/questionnaire_results?profile_id=eq.${member.id}`, { method: "PATCH", body: JSON.stringify({ answers_enc: null }) })).ok).toBe(true);
  await setWindow(true);
  await page.goto("/casa");
  await page.getByTestId("change-house-link").click();
  await expect(page.getByTestId("compare-houses")).toBeVisible();
  await expect(page.getByTestId("current-badge")).toHaveCount(1);
  // Escolhe a casa oposta à atual nos dois eixos (a que contradiz todas as respostas "muito a"): as frases são as dos EIXOS.
  const oppositeByAxes = page.getByTestId(`compare-house-${questionnaire.houseByPoles.bb}`);
  await oppositeByAxes.click();
  const expectations = page.getByTestId("expectation");
  await expect(expectations.first()).toContainText("[EXEMPLO] Nesta casa, espera-se o polo");
  expect(await expectations.count()).toBeLessThanOrEqual(2);
});

test("sabe → atividade → apresentação → escolher outra → aceitar (self), sem termo", async ({ page }) => {
  const member = await createMember("s");
  await signIn(page, member.email);
  await page.goto("/casa");
  const requests = recordRequests(page);

  await page.getByRole("button", { name: "Não aceito, prefiro escolher a casa" }).click();
  await page.getByRole("button", { name: "[PREENCHER] Atividade exemplo 2A" }).click();
  await expect(page.getByText("Conheça a casa")).toBeVisible();
  await expect(page.getByTestId("house-name")).toHaveText("Atenas");
  await page.getByRole("button", { name: "Escolher outra casa" }).click();
  await page.getByRole("button", { name: "[PREENCHER] Atividade exemplo 3A" }).click();
  await expect(page.getByTestId("house-name")).toHaveText("Alexandria");
  // O escudo da casa ao lado do nome, com o nome como alt e tamanho fixo (sem salto de layout).
  await expect(page.getByTestId("house-shield")).toHaveAttribute("alt", "Alexandria");
  await expect(page.getByTestId("house-shield")).toHaveAttribute("width", "180");
  await expect(page.getByTestId("app-logo").first()).toHaveAttribute("alt", /\S/);
  await page.getByRole("button", { name: "Aceitar" }).click();
  await expect(page.getByRole("heading", { name: "Sua casa", exact: true })).toBeVisible();
  // Casa definida com a janela fechada: sem data nem link de troca (ADR 0016).
  await expect(page.getByTestId("house-lock-notice")).toHaveCount(0);
  await expect(page.getByTestId("change-house-link")).toHaveCount(0);
  await page.goto("/inicio");
  await expect(page.getByTestId("house-lock-notice")).toHaveCount(0);
  await page.goto("/casa");

  expect(actionBodies(requests)).toEqual([[{ houseId: "alexandria", joinMethod: "self" }]]);
  expect(await houseRows(member.id)).toEqual([
    { join_method: "self", accepted_at: expect.any(String), consent_version: null, house_key: "alexandria" },
  ]);
  expect(await consents(member.id)).toEqual([]);
  await expectNoStorage(page);
});

test("recusar o termo leva à escolha direta e não grava aceite", async ({ page }) => {
  const member = await createMember("r");
  await signIn(page, member.email);
  await page.goto("/casa");
  const requests = recordRequests(page);

  await page.getByRole("button", { name: "Não aceito, prefiro escolher a casa" }).click();
  await expect(page.getByRole("heading", { name: "O que você quer fazer?" })).toBeVisible();
  await page.getByRole("button", { name: "[PREENCHER] Atividade exemplo 1A" }).click();
  await page.getByRole("button", { name: "Aceitar" }).click();
  await expect(page.getByRole("heading", { name: "Sua casa", exact: true })).toBeVisible();

  expect(actionBodies(requests)).toEqual([[{ houseId: "esparta", joinMethod: "self" }]]);
  expect(await consents(member.id)).toEqual([]);
  expect((await houseRows(member.id))[0]?.join_method).toBe("self");
});

test("quem ainda não está ativo vê o motivo e nada é gravado", async ({ page }) => {
  const member = await createMember("p");
  await signIn(page, member.email);
  // Suspensa depois do login: o banco recusa a escolha (accept_house exige perfil ativo).
  await admin(`/rest/v1/profiles?id=eq.${member.id}`, { method: "PATCH", body: JSON.stringify({ status: "suspended" }) });
  await page.goto("/casa");
  await page.getByRole("button", { name: "Não aceito, prefiro escolher a casa" }).click();
  await page.getByRole("button", { name: "[PREENCHER] Atividade exemplo 1A" }).click();
  await page.getByRole("button", { name: "Aceitar" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toHaveText("Complete o seu cadastro antes de escolher a casa.");
  expect(await houseRows(member.id)).toEqual([]);
});

test("quem ainda está só no estado (sem região) escolhe a casa (ADR 0011)", async ({ page }) => {
  const member = await createMember("e", false);
  await signIn(page, member.email);
  await page.goto("/casa");
  await page.getByRole("button", { name: "Não aceito, prefiro escolher a casa" }).click();
  await page.getByRole("button", { name: "[PREENCHER] Atividade exemplo 1A" }).click();
  await page.getByRole("button", { name: "Aceitar" }).click();
  await expect(page.getByRole("heading", { name: "Sua casa", exact: true })).toBeVisible();
  await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
  expect(await houseRows(member.id)).toEqual([
    { join_method: "self", accepted_at: expect.any(String), consent_version: null, house_key: "esparta" },
  ]);
});

test("tirada da casa pela coordenação, a pessoa vê o motivo e não volta sozinha", async ({ page }) => {
  const member = await createMember("x");
  await signIn(page, member.email);
  await page.goto("/casa");
  await page.getByRole("button", { name: "Não aceito, prefiro escolher a casa" }).click();
  await page.getByRole("button", { name: "[PREENCHER] Atividade exemplo 1A" }).click();
  await page.getByRole("button", { name: "Aceitar" }).click();
  await expect(page.getByRole("heading", { name: "Sua casa", exact: true })).toBeVisible();
  // Encerrado fora do JWT da pessoa (ended_by fica nulo, como numa operação da coordenação).
  const ended = await admin(`/rest/v1/house_members?profile_id=eq.${member.id}&left_at=is.null`, {
    method: "PATCH",
    body: JSON.stringify({ left_at: new Date().toISOString() }),
  });
  expect(ended.ok).toBe(true);
  await page.goto("/casa");
  await page.getByRole("button", { name: "Não aceito, prefiro escolher a casa" }).click();
  await page.getByRole("button", { name: "[PREENCHER] Atividade exemplo 2A" }).click();
  await page.getByRole("button", { name: "Aceitar" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toHaveText(/A coordenação tirou você da sua casa/);
  expect(await houseRows(member.id)).toEqual([]);
});
