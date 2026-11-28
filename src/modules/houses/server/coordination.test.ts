import { describe, expect, it } from "vitest";
import { instance } from "@config/instance";
import example from "@config/questionnaire.example.json";
import { parseQuestionnaire, QuestionnaireAnswerError, scoreQuestionnaire } from "@/modules/questionnaire";
import type { CipherContext, HouseClient, HouseQuery } from "../types";
import {
  changeHouse,
  setTransferWindow,
  grantQuestionnaireAccess,
  listOpenAnalysisRequests,
  readQuestionnaireResultOf,
  resolveAnalysis,
  revokeQuestionnaireAccess,
  type CoordinationCrypto,
} from "./coordination";

const questionnaire = parseQuestionnaire(example, instance.houses.map((house) => house.id));
const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";
const REQ = "33333333-3333-4333-8333-333333333333";

// Cifra de mentira, reversível, que mostra o contexto (o AAD) em cada valor.
const crypto: CoordinationCrypto = {
  encrypt: async (plain, c: CipherContext) => `enc[${c.table}.${c.column}.${c.rowId}](${plain})`,
  decrypt: async (value, c) => {
    const prefix = `enc[${c.table}.${c.column}.${c.rowId}](`;
    if (!value.startsWith(prefix)) throw new Error("aad_mismatch");
    return value.slice(prefix.length, -1);
  },
};

function fake(responses: { from?: { data?: unknown; error?: unknown }; rpc?: { data?: unknown; error?: unknown } } = {}) {
  const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];
  const filters: unknown[][] = [];
  const from = { data: responses.from?.data ?? null, error: responses.from?.error ?? null };
  const rpc = { data: responses.rpc?.data ?? null, error: responses.rpc?.error ?? null };
  const query: HouseQuery = {
    eq: (...a) => (filters.push(["eq", ...a]), query),
    is: (...a) => (filters.push(["is", ...a]), query),
    not: (...a) => (filters.push(["not", ...a]), query),
    neq: (...a) => (filters.push(["neq", ...a]), query),
    in: (...a) => (filters.push(["in", ...a]), query),
    order: (...a) => (filters.push(["order", ...a]), query),
    limit: (...a) => (filters.push(["limit", ...a]), query),
    maybeSingle: () => Promise.resolve(from),
    then: (ok, fail) => Promise.resolve(from).then(ok, fail),
  };
  const client: HouseClient = {
    rpc: (fn, args) => (rpcCalls.push({ fn, args }), Promise.resolve(rpc)),
    from: (table) => ({ select: (columns) => (filters.push(["from", table, columns]), query) }),
  };
  return { client, rpcCalls, filters };
}

describe("readQuestionnaireResultOf", () => {
  const scores = { house1: -40, house2: 75, totem1: 0, totem2: -100 };
  const row = (over: object = {}) => ({
    house_key: "casa-a",
    totem_enc: `enc[questionnaire_results.totem_enc.${U1}](XV)`,
    totem_state: "decided",
    scores_enc: `enc[questionnaire_results.scores_enc.${U1}](${JSON.stringify(scores)})`,
    source: "questionnaire",
    created_at: "t",
    ...over,
  });

  it("decifra o totem e as notas com o contexto da linha da pessoa; a coordenação recebe os 4 eixos no gráfico", async () => {
    const { client, filters } = fake({ from: { data: row() } });
    const view = await readQuestionnaireResultOf(client, U1, crypto, questionnaire);
    expect(view).toMatchObject({ houseId: "casa-a", totem: "XV", scores, source: "questionnaire", createdAt: "t" });
    expect(view?.chart?.map((axis) => axis.key)).toEqual(["house1", "house2", "totem1", "totem2"]);
    expect(filters).toContainEqual(["eq", "profile_id", U1]);
  });

  it.each(["pending", "undecided"] as const)("totem %s (nulo no banco, #197): a casa e as notas saem, o totem é nulo e a situação é explícita", async (totemState) => {
    const view = await readQuestionnaireResultOf(fake({ from: { data: row({ totem_enc: null, totem_state: totemState }) } }).client, U1, crypto, questionnaire);
    expect(view).toMatchObject({ houseId: "casa-a", totem: null, totemState, scores });
  });

  it("totem decidido: situação decidida", async () => {
    expect(await readQuestionnaireResultOf(fake({ from: { data: row() } }).client, U1, crypto, questionnaire)).toMatchObject({ totemState: "decided" });
  });

  it("resultado antigo, de antes da escala de intensidade (sem notas): notas e gráfico nulos", async () => {
    const view = await readQuestionnaireResultOf(fake({ from: { data: row({ scores_enc: null }) } }).client, U1, crypto, questionnaire);
    expect(view).toMatchObject({ totem: "XV", scores: null, chart: null });
  });

  it("sem linha (ou sem permissão na RLS): null", async () => {
    expect(await readQuestionnaireResultOf(fake().client, U1, crypto, questionnaire)).toBeNull();
  });

  it("totem ou notas cifrados para outra pessoa não decifram (o AAD amarra a linha); só o nome da coluna sobe", async () => {
    const otherTotem = fake({ from: { data: row({ totem_enc: `enc[questionnaire_results.totem_enc.${U2}](XV)` }) } });
    await expect(readQuestionnaireResultOf(otherTotem.client, U1, crypto, questionnaire)).rejects.toThrow("decrypt_failed:totem_enc");
    const otherScores = fake({ from: { data: row({ scores_enc: `enc[questionnaire_results.scores_enc.${U2}](${JSON.stringify(scores)})` }) } });
    await expect(readQuestionnaireResultOf(otherScores.client, U1, crypto, questionnaire)).rejects.toThrow("decrypt_failed:scores_enc");
  });

  it("notas com formato errado (fora de -100..100, eixo a mais) não passam", async () => {
    for (const bad of [{ ...scores, house1: 500 }, { ...scores, extra: 1 }, { house1: 1 }]) {
      const client = fake({ from: { data: row({ scores_enc: `enc[questionnaire_results.scores_enc.${U1}](${JSON.stringify(bad)})` }) } }).client;
      await expect(readQuestionnaireResultOf(client, U1, crypto, questionnaire)).rejects.toThrow("decrypt_failed:scores_enc");
    }
  });

  it("erro do banco: falha sem vazar mensagem", async () => {
    await expect(readQuestionnaireResultOf(fake({ from: { error: { code: "XX", message: "segredo" } } }).client, U1, crypto, questionnaire)).rejects.toThrow(
      "questionnaire_read_failed:failed",
    );
  });
});

describe("listOpenAnalysisRequests", () => {
  const good = (profile: string, answers: unknown) => ({
    id: REQ,
    profile_id: profile,
    kind: "full",
    tied_axes: ["house1"],
    answers_enc: `enc[house_analysis_requests.answers_enc.${profile}](${typeof answers === "string" ? answers : JSON.stringify(answers)})`,
    created_at: "t",
  });

  it("decifra as respostas de cada pedido aberto", async () => {
    const { client, filters } = fake({ from: { data: [good(U1, { q1: -3, q2: 3 })] } });
    expect(await listOpenAnalysisRequests(client, crypto, questionnaire)).toEqual({
      requests: [{ requestId: REQ, profileId: U1, kind: "full", tiedAxes: ["house1"], answers: { q1: -3, q2: 3 }, legacyKey: true, createdAt: "t" }],
      unreadable: 0,
      truncated: false,
    });
    expect(filters).toContainEqual(["eq", "status", "open"]);
    expect(filters).toContainEqual(["limit", 201]);
  });

  it("pedido com a chave atual não é 'chave antiga'; o de outra chave (itens e escala antigos) é", async () => {
    const current = good(U1, Object.fromEntries(questionnaire.items.map((item) => [item.id, -5])));
    const old = good(U2, { q01: -3, q02: 2, q27: 1, q28: -1 });
    const out = await listOpenAnalysisRequests(fake({ from: { data: [current, old] } }).client, crypto, questionnaire);
    expect(out.requests.map((r) => r.legacyKey)).toEqual([false, true]);
    expect(out.unreadable).toBe(0);
  });

  it("pedido de totem (#197) traz o tipo e só os eixos do totem", async () => {
    const totemRequest = { ...good(U1, { q1: -3 }), kind: "totem", tied_axes: ["totem2"] };
    const out = await listOpenAnalysisRequests(fake({ from: { data: [totemRequest] } }).client, crypto, questionnaire);
    expect(out.requests[0]).toMatchObject({ kind: "totem", tiedAxes: ["totem2"] });
  });

  it("sem pedidos visíveis: lista vazia", async () => {
    expect(await listOpenAnalysisRequests(fake().client, crypto, questionnaire)).toEqual({ requests: [], unreadable: 0, truncated: false });
  });

  it("mais pedidos que a página: devolve só a página e avisa que truncou", async () => {
    const many = Array.from({ length: 201 }, (_, index) => good(`00000000-0000-4000-8000-${String(index).padStart(12, "0")}`, { q1: -3 }));
    const out = await listOpenAnalysisRequests(fake({ from: { data: many } }).client, crypto, questionnaire);
    expect(out.requests).toHaveLength(200);
    expect(out.truncated).toBe(true);
  });

  it("uma linha ilegível não derruba a fila: as outras saem e só o nome da coluna é avisado", async () => {
    const SECRET = "TRECHO-EM-CLARO-QUE-NAO-PODE-VAZAR";
    const rows = [
      good(U1, { q1: -3 }),
      { ...good(U2, {}), answers_enc: `enc[house_analysis_requests.answers_enc.${U1}]({})` }, // cifrada para outra pessoa: não decifra
      good(U2, `{nao-json ${SECRET}`), // decifra, mas não é JSON
      good(U2, { q1: "a" }), // JSON de formato errado (fora da escala)
      { id: REQ, profile_id: U2 }, // linha com formato inesperado
      good(U2, { q2: 1 }),
    ];
    const reported: string[] = [];
    const out = await listOpenAnalysisRequests(fake({ from: { data: rows } }).client, crypto, questionnaire, (c) => reported.push(c));
    expect(out.requests.map((r) => r.answers)).toEqual([{ q1: -3 }, { q2: 1 }]);
    expect(out.unreadable).toBe(4);
    expect(reported).toEqual(["answers_enc", "answers_enc", "answers_enc", "row"]);
    expect(JSON.stringify(reported)).not.toContain(SECRET);
  });
});

describe("resolveAnalysis", () => {
  const houseIds = ["casa-a", "casa-b"];
  const signing = { userId: U2, nowSeconds: 1000, sign: (m: string) => `sig(${m})`, sha256Hex: (v: string) => `hash(${v})` };
  const deps = { houseIds, questionnaire, crypto, signing };
  // Respostas completas do exemplo (itens q01..), todas "muito a": notas -100 nos quatro eixos.
  const answers = Object.fromEntries(questionnaire.items.map((item) => [item.id, -5]));
  const allA = { house1: -100, house2: -100, totem1: -100, totem2: -100 };
  const requestRow = { profile_id: U1, answers_enc: `enc[house_analysis_requests.answers_enc.${U1}](${JSON.stringify(answers)})` };

  it("refaz as notas das respostas do pedido, cifra totem e notas para a pessoa e assina a resolução para quem resolve", async () => {
    const { client, rpcCalls } = fake({ from: { data: requestRow } });
    expect(await resolveAnalysis(client, { requestId: REQ, houseId: "casa-b", totem: "XV" }, deps)).toEqual({ ok: true });
    const totemEnc = `enc[questionnaire_results.totem_enc.${U1}](XV)`;
    const scoresEnc = `enc[questionnaire_results.scores_enc.${U1}](${JSON.stringify(allA)})`;
    expect(rpcCalls).toEqual([
      {
        fn: "resolve_house_analysis",
        args: {
          p_request_id: REQ,
          p_house_key: "casa-b",
          p_totem_enc: totemEnc,
          p_scores_enc: scoresEnc,
          p_answers_hash: `hash(${requestRow.answers_enc})`,
          p_issued_at: 1000,
          p_signature: `sig(resolve|${U2}|${REQ}|casa-b|${totemEnc}|${scoresEnc}|hash(${requestRow.answers_enc})|1000)`,
        },
      },
    ]);
  });

  it("recusa, sem chamar o banco, casa fora da config, totem fora do formato e campos a mais", async () => {
    const { client, rpcCalls } = fake({ from: { data: requestRow } });
    for (const input of [
      { requestId: REQ, houseId: "outra", totem: "XV" },
      { requestId: REQ, houseId: "casa-a", totem: "xv" },
      { requestId: REQ, houseId: "casa-a", totem: "XVY" },
      { requestId: "nao-uuid", houseId: "casa-a", totem: "XV" },
      { requestId: REQ, houseId: "casa-a", totem: "XV", profileId: U2 },
      { requestId: REQ, houseId: "casa-a", totem: "XV", scores: allA },
    ]) {
      expect(await resolveAnalysis(client, input, deps)).toEqual({ ok: false, error: "invalid" });
    }
    expect(rpcCalls).toEqual([]);
  });

  it("pedido que não aparece (fechado ou fora do escopo): not_found", async () => {
    expect(await resolveAnalysis(fake().client, { requestId: REQ, houseId: "casa-a", totem: "XV" }, deps)).toEqual({ ok: false, error: "not_found" });
  });

  it("pedido de chave antiga: resolve com casa e totem escolhidos, sem recalcular notas (notas nulas na assinatura)", async () => {
    const oldAnswers = { q01: -3, q02: 2, q27: 1, q28: -1 };
    const row = { profile_id: U1, answers_enc: `enc[house_analysis_requests.answers_enc.${U1}](${JSON.stringify(oldAnswers)})` };
    const { client, rpcCalls } = fake({ from: { data: row } });
    expect(await resolveAnalysis(client, { requestId: REQ, houseId: "casa-b", totem: "XV" }, deps)).toEqual({ ok: true });
    const totemEnc = `enc[questionnaire_results.totem_enc.${U1}](XV)`;
    expect(rpcCalls).toEqual([
      {
        fn: "resolve_house_analysis",
        args: {
          p_request_id: REQ,
          p_house_key: "casa-b",
          p_totem_enc: totemEnc,
          p_scores_enc: null,
          p_answers_hash: `hash(${row.answers_enc})`,
          p_issued_at: 1000,
          p_signature: `sig(resolve|${U2}|${REQ}|casa-b|${totemEnc}||hash(${row.answers_enc})|1000)`,
        },
      },
    ]);
  });

  it("respostas do pedido que não decifram ou não são inteiros da escala: falha sem chamar o banco", async () => {
    for (const answersEnc of [
      `enc[house_analysis_requests.answers_enc.${U2}](${JSON.stringify(answers)})`, // cifradas para outra pessoa
      `enc[house_analysis_requests.answers_enc.${U1}]({"q01":"a"})`, // não é número
      `enc[house_analysis_requests.answers_enc.${U1}](nao-json)`,
    ]) {
      const { client, rpcCalls } = fake({ from: { data: { profile_id: U1, answers_enc: answersEnc } } });
      expect(await resolveAnalysis(client, { requestId: REQ, houseId: "casa-a", totem: "XV" }, deps)).toEqual({ ok: false, error: "failed" });
      expect(rpcCalls).toEqual([]);
    }
  });

  it("o pedido mudou entre a leitura e a resolução (hash das respostas não confere): changed, para ler de novo", async () => {
    const { client } = fake({ from: { data: requestRow }, rpc: { error: { code: "40001" } } });
    expect(await resolveAnalysis(client, { requestId: REQ, houseId: "casa-a", totem: "XV" }, deps)).toEqual({ ok: false, error: "changed" });
  });

  it("quem não é da coordenação nacional (nem delegado no escopo): o banco recusa", async () => {
    const { client } = fake({ from: { data: requestRow }, rpc: { error: { code: "42501" } } });
    expect(await resolveAnalysis(client, { requestId: REQ, houseId: "casa-a", totem: "XV" }, deps)).toEqual({ ok: false, error: "forbidden" });
  });
});

describe("delegação do acesso", () => {
  it("concede com o id do gestor e da unidade (nunca o do próprio chamador: o banco confere)", async () => {
    const { client, rpcCalls } = fake({ rpc: { data: REQ } });
    expect(await grantQuestionnaireAccess(client, { granteeId: U1, unitId: U2 })).toEqual({ ok: true, grantId: REQ });
    expect(rpcCalls).toEqual([{ fn: "grant_questionnaire_access", args: { p_grantee: U1, p_unit_id: U2 } }]);
  });

  it("traduz os erros do banco e recusa entrada inválida sem chamar", async () => {
    expect(await grantQuestionnaireAccess(fake({ rpc: { error: { code: "42501" } } }).client, { granteeId: U1, unitId: U2 })).toEqual({ ok: false, error: "forbidden" });
    expect(await grantQuestionnaireAccess(fake({ rpc: { error: { code: "23505" } } }).client, { granteeId: U1, unitId: U2 })).toEqual({ ok: false, error: "exists" });
    expect(await grantQuestionnaireAccess(fake({ rpc: { error: { code: "22023" } } }).client, { granteeId: U1, unitId: U2 })).toEqual({ ok: false, error: "invalid" });
    const { client, rpcCalls } = fake();
    expect(await grantQuestionnaireAccess(client, { granteeId: "x", unitId: U2 })).toEqual({ ok: false, error: "invalid" });
    expect(await grantQuestionnaireAccess(client, { granteeId: U1, unitId: U2, extra: 1 })).toEqual({ ok: false, error: "invalid" });
    expect(rpcCalls).toEqual([]);
  });

  it("revoga pelo id da concessão", async () => {
    const { client, rpcCalls } = fake();
    expect(await revokeQuestionnaireAccess(client, { grantId: REQ })).toEqual({ ok: true });
    expect(rpcCalls).toEqual([{ fn: "revoke_questionnaire_access", args: { p_grant_id: REQ } }]);
    expect(await revokeQuestionnaireAccess(client, { grantId: "x" })).toEqual({ ok: false, error: "invalid" });
    expect(await revokeQuestionnaireAccess(fake({ rpc: { error: { code: "P0002" } } }).client, { grantId: REQ })).toEqual({ ok: false, error: "not_found" });
  });
});

describe("changeHouse", () => {
  const profileId = "8f1c2a4e-0b5d-4c3a-9e7f-1a2b3c4d5e6f";

  it("manda ao banco só a pessoa e a casa (o banco confere que é a coordenação nacional e a casa)", async () => {
    const { client, rpcCalls } = fake();
    expect(await changeHouse(client, { profileId, houseId: instance.houses[1]!.id }, instance.houses.map((h) => h.id))).toEqual({ ok: true });
    expect(rpcCalls).toEqual([{ fn: "coordination_set_house", args: { p_profile: profileId, p_house_key: instance.houses[1]!.id } }]);
  });

  it("recusa entrada malformada ou casa fora da config, sem chamar o banco", async () => {
    const { client, rpcCalls } = fake();
    const ids = instance.houses.map((h) => h.id);
    expect(await changeHouse(client, { profileId: "x", houseId: ids[0] }, ids)).toEqual({ ok: false, error: "invalid" });
    expect(await changeHouse(client, { profileId, houseId: "casa-inexistente" }, ids)).toEqual({ ok: false, error: "invalid" });
    expect(await changeHouse(client, { profileId, houseId: ids[0], extra: 1 }, ids)).toEqual({ ok: false, error: "invalid" });
    expect(rpcCalls).toEqual([]);
  });

  it("traduz a recusa do banco (sem alcance, casa indisponível), sem repassar o texto", async () => {
    const ids = instance.houses.map((h) => h.id);
    const forbidden = fake({ rpc: { error: { code: "42501", message: "detalhe interno" } } });
    expect(await changeHouse(forbidden.client, { profileId, houseId: ids[0] }, ids)).toEqual({ ok: false, error: "forbidden" });
    const gone = fake({ rpc: { error: { code: "P0002", message: "detalhe interno" } } });
    expect(await changeHouse(gone.client, { profileId, houseId: ids[0] }, ids)).toEqual({ ok: false, error: "not_found" });
  });
});

describe("pedido da chave antiga, com fixture realista (28 respostas q01..q28 em -3..3)", () => {
  // Como o app antigo gravava: 28 itens, escala -3..3 (sem 4 e 5), e a chave atual tem 26 itens (7, 7, 7 e 5 por eixo).
  const oldAnswers = Object.fromEntries(
    [-3, 2, -1, 1, 3, -2, -3, 1, 2, -1, 3, -2, 1, -3, 2, -1, -2, 3, 1, -1, -3, 2, 3, -2, 1, -1, 2, -3].map((value, index) => [`q${String(index + 1).padStart(2, "0")}`, value]),
  );
  const ids = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, index) => `q${String(from + index).padStart(2, "0")}`);
  const axis = (label: string, itemIds: string[]) => ({ label, poleLabels: { a: `${label}-a`, b: `${label}-b` }, itemIds });
  const current = parseQuestionnaire(
    {
      version: "chave-26",
      consentTermVersion: "termo-26",
      consentTerm: "t",
      items: ids(1, 26).map((id) => ({ id, text: "x", a: { text: "x" }, b: { text: "x" } })),
      axes: {
        house1: axis("D1", ["q01", "q05", "q09", "q13", "q17", "q23", "q25"]),
        house2: axis("D2", ["q03", "q07", "q11", "q15", "q19", "q21", "q26"]),
        totem1: { ...axis("D3", ["q02", "q06", "q10", "q14", "q18", "q22", "q24"]), letters: { a: "X", b: "Y" } },
        totem2: { ...axis("D4", ["q04", "q08", "q12", "q16", "q20"]), letters: { a: "V", b: "W" } },
      },
      houseByPoles: { aa: "casa-a", ab: "casa-b", ba: "casa-c", bb: "casa-d" },
      totemLabels: { XV: { name: "t1", description: "d" }, XW: { name: "t2", description: "d" }, YV: { name: "t3", description: "d" }, YW: { name: "t4", description: "d" } },
    },
    ["casa-a", "casa-b", "casa-c", "casa-d"],
  );
  const row = {
    id: REQ,
    profile_id: U1,
    kind: "full",
    tied_axes: ["house1"],
    answers_enc: `enc[house_analysis_requests.answers_enc.${U1}](${JSON.stringify(oldAnswers)})`,
    created_at: "t",
  };

  it("a chave atual nunca pontua essas respostas (itens q27 e q28 que não existem mais)", () => {
    expect(Object.keys(oldAnswers)).toHaveLength(28);
    try {
      scoreQuestionnaire(current, oldAnswers as never);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(QuestionnaireAnswerError);
      expect(error).toMatchObject({ code: "unknown_item", itemIds: ["q27", "q28"] });
    }
    // Mesmo só com os 26 itens atuais: os valores -2 e 2 não existem mais na escala 1-3-5.
    const onlyCurrent = Object.fromEntries(Object.entries(oldAnswers).filter(([id]) => Number(id.slice(1)) <= 26));
    expect(() => scoreQuestionnaire(current, onlyCurrent as never)).toThrow(QuestionnaireAnswerError);
  });

  it("na fila vira chave antiga (legível, não ilegível) e resolve sem notas", async () => {
    const out = await listOpenAnalysisRequests(fake({ from: { data: [row] } }).client, crypto, current);
    expect(out.unreadable).toBe(0);
    expect(out.requests).toMatchObject([{ requestId: REQ, legacyKey: true }]);
    const { client, rpcCalls } = fake({ from: { data: { profile_id: U1, answers_enc: row.answers_enc } } });
    const signing = { userId: U2, nowSeconds: 1000, sign: (m: string) => `sig(${m})`, sha256Hex: (v: string) => `hash(${v})` };
    expect(await resolveAnalysis(client, { requestId: REQ, houseId: "casa-b", totem: "XV" }, { houseIds: ["casa-a", "casa-b"], questionnaire: current, crypto, signing })).toEqual({ ok: true });
    expect(rpcCalls[0]?.args.p_scores_enc).toBeNull();
  });
});

describe("setTransferWindow", () => {
  it("manda ao banco só o estado pedido (o banco confere que é a coordenação nacional)", async () => {
    const { client, rpcCalls } = fake({ rpc: { data: true } });
    expect(await setTransferWindow(client, { open: true })).toEqual({ ok: true });
    expect(rpcCalls).toEqual([{ fn: "set_house_transfer_window", args: { p_open: true } }]);
    expect(await setTransferWindow(client, { open: false })).toEqual({ ok: true });
    expect(rpcCalls[1]).toEqual({ fn: "set_house_transfer_window", args: { p_open: false } });
  });

  it("recusa entrada malformada, sem chamar o banco", async () => {
    const { client, rpcCalls } = fake();
    expect(await setTransferWindow(client, { open: "sim" })).toEqual({ ok: false, error: "invalid" });
    expect(await setTransferWindow(client, { open: true, extra: 1 })).toEqual({ ok: false, error: "invalid" });
    expect(await setTransferWindow(client, null)).toEqual({ ok: false, error: "invalid" });
    expect(rpcCalls).toEqual([]);
  });

  it("traduz a recusa do banco (não é a coordenação nacional), sem repassar o texto", async () => {
    const forbidden = fake({ rpc: { error: { code: "42501", message: "detalhe interno" } } });
    expect(await setTransferWindow(forbidden.client, { open: true })).toEqual({ ok: false, error: "forbidden" });
  });
});
