import { describe, expect, it } from "vitest";
import { instance } from "@config/instance";
import example from "@config/questionnaire.example.json";
import { parseQuestionnaire } from "@/modules/questionnaire";
import type { CipherContext, HouseClient, HouseQuery } from "../types";
import {
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
    tied_axes: ["house1"],
    answers_enc: `enc[house_analysis_requests.answers_enc.${profile}](${typeof answers === "string" ? answers : JSON.stringify(answers)})`,
    created_at: "t",
  });

  it("decifra as respostas de cada pedido aberto", async () => {
    const { client, filters } = fake({ from: { data: [good(U1, { q1: -3, q2: 2 })] } });
    expect(await listOpenAnalysisRequests(client, crypto)).toEqual({
      requests: [{ requestId: REQ, profileId: U1, tiedAxes: ["house1"], answers: { q1: -3, q2: 2 }, createdAt: "t" }],
      unreadable: 0,
      truncated: false,
    });
    expect(filters).toContainEqual(["eq", "status", "open"]);
    expect(filters).toContainEqual(["limit", 201]);
  });

  it("sem pedidos visíveis: lista vazia", async () => {
    expect(await listOpenAnalysisRequests(fake().client, crypto)).toEqual({ requests: [], unreadable: 0, truncated: false });
  });

  it("mais pedidos que a página: devolve só a página e avisa que truncou", async () => {
    const many = Array.from({ length: 201 }, (_, index) => good(`00000000-0000-4000-8000-${String(index).padStart(12, "0")}`, { q1: -3 }));
    const out = await listOpenAnalysisRequests(fake({ from: { data: many } }).client, crypto);
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
    const out = await listOpenAnalysisRequests(fake({ from: { data: rows } }).client, crypto, (c) => reported.push(c));
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
  const answers = Object.fromEntries(questionnaire.items.map((item) => [item.id, -3]));
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

  it("respostas do pedido que não decifram ou não pontuam (escala antiga): falha sem chamar o banco", async () => {
    for (const answersEnc of [
      `enc[house_analysis_requests.answers_enc.${U2}](${JSON.stringify(answers)})`, // cifradas para outra pessoa
      `enc[house_analysis_requests.answers_enc.${U1}]({"q01":"a"})`, // escala antiga
      `enc[house_analysis_requests.answers_enc.${U1}]({"q01":-3})`, // incompletas
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
