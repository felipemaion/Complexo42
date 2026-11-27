import { describe, expect, it } from "vitest";
import type { CipherContext, HouseClient, HouseQuery } from "../types";
import {
  grantQuestionnaireAccess,
  listOpenAnalysisRequests,
  readQuestionnaireResultOf,
  resolveAnalysis,
  revokeQuestionnaireAccess,
  type CoordinationCrypto,
} from "./coordination";

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
  it("decifra o totem com o contexto da linha da pessoa", async () => {
    const { client, filters } = fake({
      from: { data: { house_key: "casa-a", totem_enc: `enc[questionnaire_results.totem_enc.${U1}](XV)`, source: "questionnaire", created_at: "t" } },
    });
    expect(await readQuestionnaireResultOf(client, U1, crypto)).toEqual({ houseId: "casa-a", totem: "XV", source: "questionnaire", createdAt: "t" });
    expect(filters).toContainEqual(["eq", "profile_id", U1]);
  });

  it("sem linha (ou sem permissão na RLS): null", async () => {
    expect(await readQuestionnaireResultOf(fake().client, U1, crypto)).toBeNull();
  });

  it("totem cifrado para outra pessoa não decifra (o AAD amarra a linha)", async () => {
    const { client } = fake({
      from: { data: { house_key: "casa-a", totem_enc: `enc[questionnaire_results.totem_enc.${U2}](XV)`, source: "analysis", created_at: "t" } },
    });
    await expect(readQuestionnaireResultOf(client, U1, crypto)).rejects.toThrow("aad_mismatch");
  });

  it("erro do banco: falha sem vazar mensagem", async () => {
    await expect(readQuestionnaireResultOf(fake({ from: { error: { code: "XX", message: "segredo" } } }).client, U1, crypto)).rejects.toThrow(
      "questionnaire_read_failed:failed",
    );
  });
});

describe("listOpenAnalysisRequests", () => {
  it("decifra as respostas de cada pedido aberto", async () => {
    const { client, filters } = fake({
      from: {
        data: [
          { id: REQ, profile_id: U1, tied_axes: ["house1"], answers_enc: `enc[house_analysis_requests.answers_enc.${U1}]({"q1":"a","q2":"both"})`, created_at: "t" },
        ],
      },
    });
    expect(await listOpenAnalysisRequests(client, crypto)).toEqual([
      { requestId: REQ, profileId: U1, tiedAxes: ["house1"], answers: { q1: "a", q2: "both" }, createdAt: "t" },
    ]);
    expect(filters).toContainEqual(["eq", "status", "open"]);
  });

  it("sem pedidos visíveis: lista vazia", async () => {
    expect(await listOpenAnalysisRequests(fake().client, crypto)).toEqual([]);
  });
});

describe("resolveAnalysis", () => {
  const houseIds = ["casa-a", "casa-b"];

  it("cifra o totem para a pessoa do pedido e resolve", async () => {
    const { client, rpcCalls } = fake({ from: { data: { profile_id: U1 } } });
    expect(await resolveAnalysis(client, { requestId: REQ, houseId: "casa-b", totem: "XV" }, houseIds, crypto)).toEqual({ ok: true });
    expect(rpcCalls).toEqual([
      {
        fn: "resolve_house_analysis",
        args: { p_request_id: REQ, p_house_key: "casa-b", p_totem_enc: `enc[questionnaire_results.totem_enc.${U1}](XV)` },
      },
    ]);
  });

  it("recusa, sem chamar o banco, casa fora da config, totem fora do formato e campos a mais", async () => {
    const { client, rpcCalls } = fake({ from: { data: { profile_id: U1 } } });
    for (const input of [
      { requestId: REQ, houseId: "outra", totem: "XV" },
      { requestId: REQ, houseId: "casa-a", totem: "xv" },
      { requestId: REQ, houseId: "casa-a", totem: "XVY" },
      { requestId: "nao-uuid", houseId: "casa-a", totem: "XV" },
      { requestId: REQ, houseId: "casa-a", totem: "XV", profileId: U2 },
    ]) {
      expect(await resolveAnalysis(client, input, houseIds, crypto)).toEqual({ ok: false, error: "invalid" });
    }
    expect(rpcCalls).toEqual([]);
  });

  it("pedido que não aparece (fechado ou fora do escopo): not_found", async () => {
    expect(await resolveAnalysis(fake().client, { requestId: REQ, houseId: "casa-a", totem: "XV" }, houseIds, crypto)).toEqual({
      ok: false,
      error: "not_found",
    });
  });

  it("quem não é da coordenação nacional (nem delegado): o banco recusa", async () => {
    const { client } = fake({ from: { data: { profile_id: U1 } }, rpc: { error: { code: "42501" } } });
    expect(await resolveAnalysis(client, { requestId: REQ, houseId: "casa-a", totem: "XV" }, houseIds, crypto)).toEqual({
      ok: false,
      error: "forbidden",
    });
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
