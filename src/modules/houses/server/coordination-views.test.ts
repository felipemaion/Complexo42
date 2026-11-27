import { describe, expect, it } from "vitest";
import { instance } from "@config/instance";
import example from "@config/questionnaire.example.json";
import { parseQuestionnaire } from "@/modules/questionnaire";
import type { CipherContext, HouseClient, HouseQuery } from "../types";
import type { CoordinationCrypto } from "./coordination";
import {
  canSeeResults,
  listCases,
  listDelegationCandidates,
  listDelegations,
  listResults,
  openCase,
  openResult,
  readCoordinationAccess,
} from "./coordination-views";

const questionnaire = parseQuestionnaire(example, instance.houses.map((house) => house.id));
const [HOUSE_A, HOUSE_B] = instance.houses.map((house) => house.id) as [string, string];
const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";
const REQ = "33333333-3333-4333-8333-333333333333";
const GRANT = "44444444-4444-4444-8444-444444444444";
const UNIT = "55555555-5555-4555-8555-555555555555";

// Cifra de mentira, reversível, que mostra o contexto (o AAD) em cada valor.
const crypto: CoordinationCrypto = {
  encrypt: async (plain, c: CipherContext) => `enc[${c.table}.${c.column}.${c.rowId}](${plain})`,
  decrypt: async (value, c) => {
    const prefix = `enc[${c.table}.${c.column}.${c.rowId}](`;
    if (!value.startsWith(prefix)) throw new Error("aad_mismatch");
    return value.slice(prefix.length, -1);
  },
};
const deps = { crypto, questionnaire };
const encName = (id: string, name: string) => `enc[profiles.display_name_enc.${id}](${name})`;
const encTotem = (id: string, totem: string) => `enc[questionnaire_results.totem_enc.${id}](${totem})`;
const scores = { house1: -40, house2: 75, totem1: 0, totem2: -100 };
const encScores = (id: string) => `enc[questionnaire_results.scores_enc.${id}](${JSON.stringify(scores)})`;
const allA = Object.fromEntries(questionnaire.items.map((item) => [item.id, -3]));
const encAnswers = (id: string, answers: object = allA) => `enc[house_analysis_requests.answers_enc.${id}](${JSON.stringify(answers)})`;

type Response = { data?: unknown; error?: unknown };
/** Cliente de mentira: uma resposta por tabela e por função, e o registro do que foi pedido. */
function fake(tables: Record<string, Response> = {}, rpcs: Record<string, Response> = {}) {
  const log: unknown[][] = [];
  const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];
  const client: HouseClient = {
    rpc: (fn, args) => {
      rpcCalls.push({ fn, args });
      log.push(["rpc", fn]);
      const r = rpcs[fn] ?? {};
      return Promise.resolve({ data: r.data ?? null, error: r.error ?? null });
    },
    from: (table) => ({
      select: (columns) => {
        const r = tables[table] ?? {};
        const response = { data: r.data ?? null, error: r.error ?? null };
        log.push(["from", table, columns]);
        const query: HouseQuery = {
          eq: (...a) => (log.push(["eq", ...a]), query),
          is: (...a) => (log.push(["is", ...a]), query),
          not: (...a) => (log.push(["not", ...a]), query),
          in: (...a) => (log.push(["in", ...a]), query),
          order: (...a) => (log.push(["order", ...a]), query),
          limit: (...a) => (log.push(["limit", ...a]), query),
          maybeSingle: () => Promise.resolve(response),
          then: (ok, fail) => Promise.resolve(response).then(ok, fail),
        };
        return query;
      },
    }),
  };
  return { client, log, rpcCalls };
}

describe("readCoordinationAccess e canSeeResults", () => {
  it("devolve nacional e delegado como o banco respondeu", async () => {
    const national = fake({}, { questionnaire_coordination_access: { data: { national: true, delegate: false } } });
    expect(await readCoordinationAccess(national.client)).toEqual({ national: true, delegate: false });
    const delegate = fake({}, { questionnaire_coordination_access: { data: { national: false, delegate: true } } });
    expect(await readCoordinationAccess(delegate.client)).toEqual({ national: false, delegate: true });
  });

  it("erro, resposta inesperada ou sem permissão: nada (falha fechado)", async () => {
    for (const r of [{ error: { code: "42501" } }, { data: null }, { data: { national: "sim" } }, { data: "x" }]) {
      expect(await readCoordinationAccess(fake({}, { questionnaire_coordination_access: r }).client)).toEqual({ national: false, delegate: false });
    }
  });

  it("ver os resultados: a nacional ou o delegado; mais ninguém", () => {
    expect(canSeeResults({ national: true, delegate: false })).toBe(true);
    expect(canSeeResults({ national: false, delegate: true })).toBe(true);
    expect(canSeeResults({ national: false, delegate: false })).toBe(false);
  });
});

describe("listResults", () => {
  const resultRows = [
    { profile_id: U1, house_key: HOUSE_A, totem_enc: encTotem(U1, "XV"), created_at: "2026-11-27T10:00:00Z" },
    { profile_id: U2, house_key: HOUSE_B, totem_enc: encTotem(U2, "YW"), created_at: "2026-11-26T10:00:00Z" },
  ];
  const profiles = [
    { id: U1, display_name_enc: encName(U1, "Ana Teste") },
    { id: U2, display_name_enc: encName(U2, "Beto Teste") },
  ];

  it("lista casa, totem decifrado, data e nome, do mais novo ao mais antigo", async () => {
    const { client, log } = fake({ questionnaire_results: { data: resultRows }, profiles: { data: profiles } });
    const out = await listResults(client, deps, {});
    expect(out).toEqual({
      rows: [
        { profileId: U1, name: "Ana Teste", houseId: HOUSE_A, totem: "XV", createdAt: "2026-11-27T10:00:00Z" },
        { profileId: U2, name: "Beto Teste", houseId: HOUSE_B, totem: "YW", createdAt: "2026-11-26T10:00:00Z" },
      ],
      unreadable: 0,
    });
    expect(log).toContainEqual(["order", "created_at", { ascending: false }]);
    expect(log).toContainEqual(["in", "id", [U1, U2]]);
  });

  it("filtra pela casa no banco", async () => {
    const { client, log } = fake({ questionnaire_results: { data: [resultRows[1]] }, profiles: { data: profiles } });
    await listResults(client, deps, { houseId: HOUSE_B });
    expect(log).toContainEqual(["eq", "house_key", HOUSE_B]);
  });

  it("ignora filtro de casa que não é da config (não vai ao banco)", async () => {
    const { client, log } = fake({ questionnaire_results: { data: [] }, profiles: { data: [] } });
    await listResults(client, deps, { houseId: "casa-inventada" });
    expect(log.some((entry) => entry[0] === "eq" && entry[1] === "house_key")).toBe(false);
  });

  it("totem que não decifra: a linha sai da lista e é contada, sem derrubar as outras nem vazar", async () => {
    const rows = [{ ...resultRows[0], totem_enc: encTotem(U2, "XV") }, resultRows[1]];
    const { client } = fake({ questionnaire_results: { data: rows }, profiles: { data: profiles } });
    const out = await listResults(client, deps, {});
    expect(out.rows.map((r) => r.profileId)).toEqual([U2]);
    expect(out.unreadable).toBe(1);
  });

  it("nome que não decifra vira null (a pessoa continua na lista)", async () => {
    const { client } = fake({
      questionnaire_results: { data: [resultRows[0]] },
      profiles: { data: [{ id: U1, display_name_enc: encName(U2, "Outra") }] },
    });
    expect((await listResults(client, deps, {})).rows[0]?.name).toBeNull();
  });

  it("sem resultados visíveis (RLS): lista vazia, sem consultar nomes", async () => {
    const { client, log } = fake({ questionnaire_results: { data: [] } });
    expect(await listResults(client, deps, {})).toEqual({ rows: [], unreadable: 0 });
    expect(log.some((entry) => entry[0] === "from" && entry[1] === "profiles")).toBe(false);
  });

  it("erro do banco: falha sem vazar mensagem", async () => {
    const { client } = fake({ questionnaire_results: { error: { code: "XX", message: "segredo" } } });
    await expect(listResults(client, deps, {})).rejects.toThrow("results_read_failed:failed");
  });
});

describe("openResult (abrir o resultado de uma pessoa registra o acesso)", () => {
  const resultRow = {
    house_key: HOUSE_A,
    totem_enc: encTotem(U1, "XV"),
    scores_enc: encScores(U1),
    source: "questionnaire",
    created_at: "t",
  };

  it("lê o resultado, registra a visualização (ator e alvo, sem conteúdo) e devolve o gráfico completo", async () => {
    const { client, log, rpcCalls } = fake({ questionnaire_results: { data: resultRow }, profiles: { data: { id: U1, display_name_enc: encName(U1, "Ana") } } });
    const out = await openResult(client, U1, deps);
    expect(out.status).toBe("ok");
    if (out.status !== "ok") return;
    expect(out.name).toBe("Ana");
    expect(out.result).toMatchObject({ houseId: HOUSE_A, totem: "XV", scores });
    expect(out.result.chart?.map((axis) => axis.key)).toEqual(["house1", "house2", "totem1", "totem2"]);
    expect(rpcCalls).toEqual([{ fn: "log_questionnaire_view", args: { p_target: U1 } }]);
    // Lê antes de registrar: quem não tem resultado visível não gera evento.
    expect(log.findIndex((e) => e[0] === "from" && e[1] === "questionnaire_results")).toBeLessThan(log.findIndex((e) => e[0] === "rpc"));
  });

  it("id que não é uuid: not_found, sem consultar o banco", async () => {
    const { client, log } = fake();
    expect(await openResult(client, "../x", deps)).toEqual({ status: "not_found" });
    expect(log).toEqual([]);
  });

  it("sem resultado visível (sem permissão ou inexistente): not_found e nenhum evento", async () => {
    const { client, rpcCalls } = fake({ questionnaire_results: { data: null } });
    expect(await openResult(client, U1, deps)).toEqual({ status: "not_found" });
    expect(rpcCalls).toEqual([]);
  });

  it("o banco recusa registrar o acesso: not_found (não mostra o resultado)", async () => {
    const { client } = fake({ questionnaire_results: { data: resultRow } }, { log_questionnaire_view: { error: { code: "42501" } } });
    expect(await openResult(client, U1, deps)).toEqual({ status: "not_found" });
  });

  it("totem ou notas ilegíveis: unreadable, sem registrar acesso nem vazar o motivo", async () => {
    const { client, rpcCalls } = fake({ questionnaire_results: { data: { ...resultRow, totem_enc: encTotem(U2, "XV") } } });
    expect(await openResult(client, U1, deps)).toEqual({ status: "unreadable" });
    expect(rpcCalls).toEqual([]);
  });
});

describe("listCases e openCase (fila de análise)", () => {
  const requestRow = (id: string, over: object = {}) => ({
    id: REQ,
    profile_id: id,
    tied_axes: ["house2", "totem1"],
    answers_enc: encAnswers(id),
    created_at: "2026-11-27T09:00:00Z",
    ...over,
  });

  it("lista nome, data e eixos empatados dos casos abertos, e conta as linhas ilegíveis", async () => {
    const rows = [requestRow(U1), requestRow(U2, { answers_enc: encAnswers(U1) })];
    const { client } = fake({
      house_analysis_requests: { data: rows },
      profiles: { data: [{ id: U1, display_name_enc: encName(U1, "Ana") }] },
    });
    const out = await listCases(client, deps);
    expect(out.rows).toEqual([{ requestId: REQ, profileId: U1, name: "Ana", tiedAxes: ["house2", "totem1"], createdAt: "2026-11-27T09:00:00Z" }]);
    expect(out.unreadable).toBe(1);
  });

  it("abrir o caso devolve as respostas, as notas e o gráfico completo, e registra o acesso à pessoa", async () => {
    const { client, rpcCalls } = fake(
      { house_analysis_requests: { data: [requestRow(U1)] }, profiles: { data: { id: U1, display_name_enc: encName(U1, "Ana") } } },
      {},
    );
    const out = await openCase(client, REQ, deps);
    expect(out.status).toBe("ok");
    if (out.status !== "ok") return;
    expect(out).toMatchObject({ requestId: REQ, profileId: U1, name: "Ana", tiedAxes: ["house2", "totem1"] });
    expect(out.answers).toEqual(allA);
    expect(out.scores).toEqual({ house1: -100, house2: -100, totem1: -100, totem2: -100 });
    expect(out.chart).toHaveLength(4);
    expect(rpcCalls).toEqual([{ fn: "log_questionnaire_view", args: { p_target: U1 } }]);
  });

  it("caso que não está na fila visível, id inválido ou acesso recusado: not_found", async () => {
    expect(await openCase(fake({ house_analysis_requests: { data: [] } }).client, REQ, deps)).toEqual({ status: "not_found" });
    expect(await openCase(fake().client, "x", deps)).toEqual({ status: "not_found" });
    const refused = fake({ house_analysis_requests: { data: [requestRow(U1)] } }, { log_questionnaire_view: { error: { code: "42501" } } });
    expect(await openCase(refused.client, REQ, deps)).toEqual({ status: "not_found" });
  });

  it("respostas que não pontuam (escala antiga ou incompletas): unreadable", async () => {
    const old = fake({ house_analysis_requests: { data: [requestRow(U1, { answers_enc: encAnswers(U1, { q01: -3 }) })] } });
    expect(await openCase(old.client, REQ, deps)).toEqual({ status: "unreadable" });
  });
});

describe("delegações", () => {
  it("lista as concessões ativas com o nome do gestor e da unidade", async () => {
    const { client, log } = fake({
      questionnaire_data_grants: { data: [{ id: GRANT, grantee_id: U1, unit_id: UNIT, granted_at: "t", unit: { name: "Estado Exemplo" } }] },
      profiles: { data: [{ id: U1, display_name_enc: encName(U1, "Gestora") }] },
    });
    expect(await listDelegations(client, deps)).toEqual([
      { grantId: GRANT, granteeId: U1, granteeName: "Gestora", unitId: UNIT, unitName: "Estado Exemplo", grantedAt: "t" },
    ]);
    expect(log).toContainEqual(["is", "revoked_at", null]);
  });

  it("lista os candidatos: gestores ativos de unidade abaixo da raiz", async () => {
    const { client, log } = fake({
      role_assignments: { data: [{ profile_id: U1, unit_id: UNIT, unit: { name: "Estado Exemplo", parent_id: "raiz" } }] },
      profiles: { data: [{ id: U1, display_name_enc: encName(U1, "Gestora") }] },
    });
    expect(await listDelegationCandidates(client, deps)).toEqual([{ granteeId: U1, granteeName: "Gestora", unitId: UNIT, unitName: "Estado Exemplo" }]);
    expect(log).toContainEqual(["eq", "role", "manager"]);
    expect(log).toContainEqual(["is", "revoked_at", null]);
    expect(log).toContainEqual(["not", "unit.parent_id", null]);
  });

  it("erro do banco: falha sem vazar mensagem", async () => {
    await expect(listDelegations(fake({ questionnaire_data_grants: { error: { code: "XX", message: "segredo" } } }).client, deps)).rejects.toThrow(
      "delegations_read_failed:failed",
    );
  });
});
