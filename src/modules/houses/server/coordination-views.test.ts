import { describe, expect, it } from "vitest";
import { instance } from "@config/instance";
import example from "@config/questionnaire.example.json";
import { parseQuestionnaire } from "@/modules/questionnaire";
import type { CipherContext, HouseClient, HouseQuery } from "../types";
import type { CoordinationCrypto } from "./coordination";
import {
  canSeeResults,
  choseOtherHouse,
  listCases,
  listDelegationCandidates,
  listDelegations,
  listResults,
  maxResultRows,
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
const allA = Object.fromEntries(questionnaire.items.map((item) => [item.id, -5]));
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
          neq: (...a) => (log.push(["neq", ...a]), query),
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
  const VIEWER = "99999999-9999-4999-8999-999999999999";
  const resultRows = [
    { profile_id: U1, house_key: HOUSE_A, created_at: "2026-11-27T10:00:00Z", totem_enc: encTotem(U1, "XV") },
    { profile_id: U2, house_key: HOUSE_B, created_at: "2026-11-26T10:00:00Z", totem_enc: encTotem(U2, "YW") },
  ];
  const profiles = [
    { id: U1, display_name_enc: encName(U1, "Ana Teste") },
    { id: U2, display_name_enc: encName(U2, "Beto Teste") },
  ];
  const manyRows = (count: number) =>
    Array.from({ length: count }, (_, index) => ({
      profile_id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      house_key: HOUSE_A,
      created_at: "2026-11-27T10:00:00Z",
    }));

  // Casa escolhida (vínculo aberto) lida pela função do banco: U1 escolheu a sugerida; U2 escolheu outra, por troca da coordenação.
  const chosen = [
    { profile_id: U1, house_key: HOUSE_A, chosen_at: "2026-11-27T11:00:00Z", changed_by_coordination_at: null },
    { profile_id: U2, house_key: HOUSE_A, chosen_at: "2026-11-27T12:00:00Z", changed_by_coordination_at: "2026-11-27T12:00:00Z" },
  ];

  it("lista nome, casa sugerida, casa escolhida, totem e datas (nada de nota), do mais novo ao mais antigo", async () => {
    const { client, log, rpcCalls } = fake({ questionnaire_results: { data: resultRows }, profiles: { data: profiles } }, { coordination_chosen_houses: { data: chosen } });
    const out = await listResults(client, deps, VIEWER, {});
    expect(out).toEqual({
      rows: [
        { profileId: U1, name: "Ana Teste", houseId: HOUSE_A, createdAt: "2026-11-27T10:00:00Z", chosenHouseId: HOUSE_A, chosenAt: "2026-11-27T11:00:00Z", changedByCoordinationAt: null, totem: "XV" },
        { profileId: U2, name: "Beto Teste", houseId: HOUSE_B, createdAt: "2026-11-26T10:00:00Z", chosenHouseId: HOUSE_A, chosenAt: "2026-11-27T12:00:00Z", changedByCoordinationAt: "2026-11-27T12:00:00Z", totem: "YW" },
      ],
      truncated: false,
    });
    expect(rpcCalls).toEqual([{ fn: "coordination_chosen_houses", args: { p_profiles: [U1, U2] } }]);
    expect(log).toContainEqual(["order", "created_at", { ascending: false }]);
    // O totem vem numa leitura à parte, só das pessoas da página; as notas (scores_enc) nunca são pedidas.
    const columns = log.filter((e) => e[0] === "from" && e[1] === "questionnaire_results").map((e) => String(e[2]));
    expect(columns).toEqual(["profile_id,house_key,created_at", "profile_id,totem_enc"]);
    expect(log).toContainEqual(["in", "profile_id", [U1, U2]]);
  });

  it("totem ilegível, fora da config ou ausente: a linha sai com totem nulo (a lista não cai)", async () => {
    const rows = [
      { ...resultRows[0], totem_enc: "lixo" },
      { ...resultRows[1], totem_enc: encTotem(U2, "ZZ") },
    ];
    const { client } = fake({ questionnaire_results: { data: rows }, profiles: { data: profiles } }, { coordination_chosen_houses: { data: chosen } });
    const out = await listResults(client, deps, VIEWER, {});
    expect(out.rows.map((row) => row.totem)).toEqual([null, null]);
  });

  it("filtro \"outra casa\" também traz o totem (leitura à parte, pelos ids da página)", async () => {
    const other = [{ profile_id: U2, house_key: HOUSE_B, created_at: "2026-11-26T10:00:00Z" }];
    const { client } = fake({ questionnaire_results: { data: resultRows }, profiles: { data: profiles } }, { coordination_other_house_results: { data: other }, coordination_chosen_houses: { data: chosen } });
    const out = await listResults(client, deps, VIEWER, { otherHouse: true });
    expect(out.rows.map((row) => [row.profileId, row.totem])).toEqual([[U2, "YW"]]);
  });

  it("quem ainda não aceitou casa fica com a casa escolhida vazia", async () => {
    const { client } = fake({ questionnaire_results: { data: [resultRows[0]] }, profiles: { data: profiles } }, { coordination_chosen_houses: { data: [{ profile_id: U1, house_key: null, chosen_at: null, changed_by_coordination_at: null }] } });
    const out = await listResults(client, deps, VIEWER, {});
    expect(out.rows[0]).toMatchObject({ chosenHouseId: null, chosenAt: null, changedByCoordinationAt: null });
  });

  it("filtro \"escolheu outra casa\": o banco filtra (todas as pessoas do alcance), sem ler a tabela de resultados", async () => {
    const other = [{ profile_id: U2, house_key: HOUSE_B, created_at: "2026-11-26T10:00:00Z" }];
    const { client, log, rpcCalls } = fake({ profiles: { data: profiles } }, { coordination_other_house_results: { data: other }, coordination_chosen_houses: { data: chosen } });
    const out = await listResults(client, deps, VIEWER, { otherHouse: true, houseId: HOUSE_B });
    expect(out.rows.map((row) => row.profileId)).toEqual([U2]);
    expect(rpcCalls[0]).toEqual({ fn: "coordination_other_house_results", args: { p_house: HOUSE_B, p_limit: maxResultRows + 1 } });
    expect(log.some((entry) => entry[0] === "from" && entry[1] === "questionnaire_results")).toBe(false);
  });

  it("filtro \"escolheu outra casa\" com mais linhas que a página: mostra a página e avisa que truncou (e sem filtro de casa manda nulo)", async () => {
    const many = manyRows(maxResultRows + 1).map((row) => ({ ...row }));
    const { client, rpcCalls } = fake({ profiles: { data: [] } }, { coordination_other_house_results: { data: many }, coordination_chosen_houses: { data: [] } });
    const out = await listResults(client, deps, VIEWER, { otherHouse: true });
    expect(out.rows).toHaveLength(maxResultRows);
    expect(out.truncated).toBe(true);
    expect(rpcCalls[0]).toEqual({ fn: "coordination_other_house_results", args: { p_house: null, p_limit: maxResultRows + 1 } });
  });

  it("erro do banco no filtro: falha sem vazar mensagem", async () => {
    const { client } = fake({}, { coordination_other_house_results: { error: { code: "42501", message: "detalhe interno" } } });
    await expect(listResults(client, deps, VIEWER, { otherHouse: true })).rejects.toThrow("results_read_failed");
  });

  it("erro ao ler a casa escolhida: a tela falha (erro visível), sem mostrar a coluna vazia como se fosse verdade", async () => {
    const { client } = fake({ questionnaire_results: { data: resultRows }, profiles: { data: profiles } }, { coordination_chosen_houses: { error: { code: "42501", message: "detalhe interno" } } });
    await expect(listResults(client, deps, VIEWER, {})).rejects.toThrow("results_read_failed");
  });

  it("não lista a própria pessoa (quem vê não abre o próprio resultado por aqui)", async () => {
    const { client, log } = fake({ questionnaire_results: { data: [] } });
    await listResults(client, deps, VIEWER, {});
    expect(log).toContainEqual(["neq", "profile_id", VIEWER]);
  });

  it("filtra pela casa no banco", async () => {
    const { client, log } = fake({ questionnaire_results: { data: [resultRows[1]] }, profiles: { data: profiles } });
    await listResults(client, deps, VIEWER, { houseId: HOUSE_B });
    expect(log).toContainEqual(["eq", "house_key", HOUSE_B]);
  });

  it("ignora filtro de casa que não é da config (não vai ao banco)", async () => {
    const { client, log } = fake({ questionnaire_results: { data: [] }, profiles: { data: [] } });
    await listResults(client, deps, VIEWER, { houseId: "casa-inventada" });
    expect(log.some((entry) => entry[0] === "eq" && entry[1] === "house_key")).toBe(false);
  });

  it("mais linhas que a página: mostra só a página e avisa que truncou (filtre por casa)", async () => {
    const { client, log } = fake({ questionnaire_results: { data: manyRows(maxResultRows + 1) }, profiles: { data: [] } });
    const out = await listResults(client, deps, VIEWER, {});
    expect(out.rows).toHaveLength(maxResultRows);
    expect(out.truncated).toBe(true);
    expect(log).toContainEqual(["limit", maxResultRows + 1]);
  });

  it("os nomes são buscados em lotes pequenos (a URL não estoura com centenas de ids)", async () => {
    const { client, log } = fake({ questionnaire_results: { data: manyRows(120) }, profiles: { data: [] } });
    await listResults(client, deps, VIEWER, {});
    const sizes = log.filter((e) => e[0] === "in" && e[1] === "id").map((e) => (e[2] as string[]).length);
    expect(sizes).toEqual([50, 50, 20]);
  });

  it("nome que não decifra vira null (a pessoa continua na lista)", async () => {
    const { client } = fake({
      questionnaire_results: { data: [resultRows[0]] },
      profiles: { data: [{ id: U1, display_name_enc: encName(U2, "Outra") }] },
    });
    expect((await listResults(client, deps, VIEWER, {})).rows[0]?.name).toBeNull();
  });

  it("erro ao buscar os nomes: a tela falha (erro visível), em vez de mostrar todo mundo sem nome", async () => {
    const { client } = fake({ questionnaire_results: { data: [resultRows[0]] }, profiles: { error: { code: "XX", message: "segredo" } } });
    await expect(listResults(client, deps, VIEWER, {})).rejects.toThrow("names_read_failed:failed");
  });

  it("sem resultados visíveis (RLS): lista vazia, sem consultar nomes", async () => {
    const { client, log } = fake({ questionnaire_results: { data: [] } });
    expect(await listResults(client, deps, VIEWER, {})).toEqual({ rows: [], truncated: false });
    expect(log.some((entry) => entry[0] === "from" && entry[1] === "profiles")).toBe(false);
  });

  it("erro do banco: falha sem vazar mensagem", async () => {
    const { client } = fake({ questionnaire_results: { error: { code: "XX", message: "segredo" } } });
    await expect(listResults(client, deps, VIEWER, {})).rejects.toThrow("results_read_failed:failed");
  });
});

describe("openResult (abrir o resultado de uma pessoa registra o acesso)", () => {
  const resultRow = {
    house_key: HOUSE_A,
    totem_enc: encTotem(U1, "XV"),
    totem_state: "decided",
    scores_enc: encScores(U1),
    source: "questionnaire",
    created_at: "t",
  };

  it("lê o resultado, registra a visualização (ator e alvo, sem conteúdo) e devolve o gráfico completo", async () => {
    const { client, log, rpcCalls } = fake({ questionnaire_results: { data: resultRow }, profiles: { data: { id: U1, display_name_enc: encName(U1, "Ana") } } }, { coordination_chosen_houses: { data: [{ profile_id: U1, house_key: HOUSE_B, chosen_at: "2026-11-27T11:00:00Z", changed_by_coordination_at: null }] } });
    const out = await openResult(client, U1, deps);
    expect(out.status).toBe("ok");
    if (out.status !== "ok") return;
    expect(out.name).toBe("Ana");
    // A casa sugerida (do resultado) e a escolhida (vínculo aberto), com a data da escolha.
    expect(out.choice).toEqual({ houseId: HOUSE_B, chosenAt: "2026-11-27T11:00:00Z", changedByCoordinationAt: null });
    expect(out.result).toMatchObject({ houseId: HOUSE_A, totem: "XV", scores });
    expect(out.result.chart?.map((axis) => axis.key)).toEqual(["house1", "house2", "totem1", "totem2"]);
    expect(rpcCalls).toEqual([
      { fn: "log_questionnaire_view", args: { p_target: U1 } },
      { fn: "coordination_chosen_houses", args: { p_profiles: [U1] } },
    ]);
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

  it("totem pendente (#197): abre com a casa e o totem nulo", async () => {
    const { client } = fake({ questionnaire_results: { data: { ...resultRow, totem_enc: null, totem_state: "pending" } }, profiles: { data: { id: U1, display_name_enc: encName(U1, "Ana") } } });
    const out = await openResult(client, U1, deps);
    expect(out.status).toBe("ok");
    if (out.status === "ok") expect(out.result).toMatchObject({ houseId: HOUSE_A, totem: null, totemState: "pending" });
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
    kind: "full",
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
    expect(out.rows).toEqual([{ requestId: REQ, profileId: U1, name: "Ana", kind: "full", tiedAxes: ["house2", "totem1"], legacyKey: false, createdAt: "2026-11-27T09:00:00Z" }]);
    expect(out.unreadable).toBe(1);
    expect(out.truncated).toBe(false);
  });

  it("caso de chave antiga: aparece na fila marcado e abre sem notas, gráfico nem respostas, registrando o acesso", async () => {
    const oldEnc = (id: string) => `enc[house_analysis_requests.answers_enc.${id}](${JSON.stringify({ q01: -3, q02: 2, q27: 1, q28: -1 })})`;
    const row = requestRow(U1, { answers_enc: oldEnc(U1) });
    const names = { profiles: { data: [{ id: U1, display_name_enc: encName(U1, "Ana") }] } };
    const listed = await listCases(fake({ house_analysis_requests: { data: [row] }, ...names }).client, deps);
    expect(listed.rows).toMatchObject([{ requestId: REQ, legacyKey: true }]);
    expect(listed.unreadable).toBe(0);
    const { client, rpcCalls } = fake({ house_analysis_requests: { data: row }, profiles: { data: { id: U1, display_name_enc: encName(U1, "Ana") } } });
    const out = await openCase(client, REQ, deps);
    expect(out).toMatchObject({ status: "ok", requestId: REQ, legacyKey: true, scores: null, chart: [], answers: {} });
    expect(rpcCalls).toEqual([{ fn: "log_questionnaire_view", args: { p_target: U1 } }]);
  });

  it("pessoa de perfil incompleto (ADR 0017, sem nome): a fila a lista com nome nulo, sem quebrar", async () => {
    const { client } = fake({ house_analysis_requests: { data: [requestRow(U1)] }, profiles: { data: [{ id: U1, display_name_enc: null }] } });
    const out = await listCases(client, deps);
    expect(out.rows).toMatchObject([{ requestId: REQ, profileId: U1, name: null }]);
    expect(out.unreadable).toBe(0);
  });

  it("abrir o caso busca SÓ esse pedido aberto (não decifra a fila inteira)", async () => {
    const { client, log } = fake({ house_analysis_requests: { data: requestRow(U1) }, profiles: { data: { id: U1, display_name_enc: encName(U1, "Ana") } } });
    await openCase(client, REQ, deps);
    expect(log).toContainEqual(["eq", "id", REQ]);
    expect(log).toContainEqual(["eq", "status", "open"]);
    expect(log.filter((e) => e[0] === "from" && e[1] === "house_analysis_requests")).toHaveLength(1);
  });

  it("abrir o caso devolve as respostas, as notas e o gráfico completo, e registra o acesso à pessoa", async () => {
    const { client, rpcCalls } = fake(
      { house_analysis_requests: { data: requestRow(U1) }, profiles: { data: { id: U1, display_name_enc: encName(U1, "Ana") } } },
      {},
    );
    const out = await openCase(client, REQ, deps);
    expect(out.status).toBe("ok");
    if (out.status !== "ok") return;
    expect(out).toMatchObject({ requestId: REQ, profileId: U1, name: "Ana", tiedAxes: ["house2", "totem1"] });
    expect(out.legacyKey).toBe(false);
    expect(out.answers).toEqual(allA);
    expect(out.scores).toEqual({ house1: -100, house2: -100, totem1: -100, totem2: -100 });
    expect(out.chart).toHaveLength(4);
    expect(rpcCalls).toEqual([{ fn: "log_questionnaire_view", args: { p_target: U1 } }]);
  });

  it("caso de totem (#197): abrir traz o tipo e a casa já definida do resultado, para a coordenação decidir só o totem", async () => {
    const totemScores = { house1: -40, house2: 75, totem1: 0, totem2: -100 };
    const { client } = fake({
      house_analysis_requests: { data: requestRow(U1, { kind: "totem", tied_axes: ["totem1"] }) },
      questionnaire_results: {
        data: {
          house_key: HOUSE_B,
          totem_enc: null,
          totem_state: "pending",
          scores_enc: `enc[questionnaire_results.scores_enc.${U1}](${JSON.stringify(totemScores)})`,
          source: "questionnaire",
          created_at: "t",
        },
      },
      profiles: { data: { id: U1, display_name_enc: encName(U1, "Ana") } },
    });
    const out = await openCase(client, REQ, deps);
    expect(out).toMatchObject({ status: "ok", kind: "totem", tiedAxes: ["totem1"], houseId: HOUSE_B });
  });

  it("caso de totem sem o resultado da casa: unreadable (a casa precisa estar definida)", async () => {
    const { client } = fake({ house_analysis_requests: { data: requestRow(U1, { kind: "totem", tied_axes: ["totem1"] }) } });
    expect(await openCase(client, REQ, deps)).toEqual({ status: "unreadable" });
  });

  it("caso que não está na fila visível, id inválido ou acesso recusado: not_found", async () => {
    expect(await openCase(fake({ house_analysis_requests: { data: null } }).client, REQ, deps)).toEqual({ status: "not_found" });
    expect(await openCase(fake().client, "x", deps)).toEqual({ status: "not_found" });
    const refused = fake({ house_analysis_requests: { data: requestRow(U1) } }, { log_questionnaire_view: { error: { code: "42501" } } });
    expect(await openCase(refused.client, REQ, deps)).toEqual({ status: "not_found" });
  });

  it("respostas que não são inteiros da escala (formato errado): unreadable", async () => {
    const bad = fake({ house_analysis_requests: { data: requestRow(U1, { answers_enc: encAnswers(U1, { q01: "a" }) }) } });
    expect(await openCase(bad.client, REQ, deps)).toEqual({ status: "unreadable" });
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
    expect(log).toContainEqual(["not", "unit.parent_id", "is", null]);
  });

  it("erro do banco: falha sem vazar mensagem", async () => {
    await expect(listDelegations(fake({ questionnaire_data_grants: { error: { code: "XX", message: "segredo" } } }).client, deps)).rejects.toThrow(
      "delegations_read_failed:failed",
    );
  });
});

describe("choseOtherHouse", () => {
  const row = { houseId: HOUSE_A, chosenHouseId: HOUSE_A as string | null };
  it("só é verdadeiro com casa escolhida diferente da sugerida", () => {
    expect(choseOtherHouse(row)).toBe(false);
    expect(choseOtherHouse({ ...row, chosenHouseId: HOUSE_B })).toBe(true);
    expect(choseOtherHouse({ ...row, chosenHouseId: null })).toBe(false);
  });
});
