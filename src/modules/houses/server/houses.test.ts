import { describe, expect, it } from "vitest";
import type { HouseClient, HouseQuery } from "../types";
import { acceptHouse, readAcceptedHouse, recordConsent, recordQuestionnaireResult, requestHouseAnalysis } from "./houses";

const houseIds = ["casa-a", "casa-b"];

type Call = { fn: string; args: Record<string, unknown> };

function fakeClient(result: { data?: unknown; error?: unknown } = {}) {
  const calls: Call[] = [];
  const filters: unknown[][] = [];
  const response = { data: result.data ?? null, error: result.error ?? null };
  const query: HouseQuery = {
    eq: (...a) => (filters.push(["eq", ...a]), query),
    is: (...a) => (filters.push(["is", ...a]), query),
    not: (...a) => (filters.push(["not", ...a]), query),
    maybeSingle: () => Promise.resolve(response),
    then: (ok, fail) => Promise.resolve(response).then(ok, fail),
  };
  const client: HouseClient = {
    rpc: (fn, args) => {
      calls.push({ fn, args });
      return Promise.resolve(response);
    },
    from: (table) => ({
      select: (columns) => {
        filters.push(["from", table, columns]);
        return query;
      },
    }),
  };
  return { client, calls, filters };
}

describe("acceptHouse", () => {
  it("manda ao banco só o id da casa e a forma de entrada", async () => {
    const { client, calls } = fakeClient();
    expect(await acceptHouse(client, { houseId: "casa-b", joinMethod: "questionnaire" }, houseIds, "termo-1")).toEqual({ ok: true });
    expect(await acceptHouse(client, { houseId: "casa-a", joinMethod: "self" }, houseIds, "termo-1")).toEqual({ ok: true });
    expect(calls).toEqual([
      { fn: "accept_house", args: { p_house_key: "casa-b", p_join_method: "questionnaire", p_term_version: "termo-1" } },
      { fn: "accept_house", args: { p_house_key: "casa-a", p_join_method: "self", p_term_version: null } },
    ]);
  });

  it("a versão do termo é a do servidor: uma versão mandada pelo navegador é recusada", async () => {
    const { client, calls } = fakeClient();
    const input = { houseId: "casa-a", joinMethod: "questionnaire", termVersion: "termo-forjado" };
    expect(await acceptHouse(client, input, houseIds, "termo-1")).toEqual({ ok: false, error: "failed" });
    expect(calls).toEqual([]);
  });

  it("recusa, sem chamar o banco, casa fora da config, forma inválida e qualquer campo a mais (respostas)", async () => {
    const { client, calls } = fakeClient();
    for (const input of [
      { houseId: "casa-x", joinMethod: "self" },
      { houseId: "casa-a", joinMethod: "manual" },
      { houseId: "casa-a", joinMethod: "questionnaire", answers: { q01: "a" } },
      { houseId: "casa-a" },
      "casa-a",
      null,
    ]) {
      expect(await acceptHouse(client, input, houseIds, "termo-1")).toEqual({ ok: false, error: "failed" });
    }
    expect(calls).toEqual([]);
  });

  it("traduz o erro do banco em motivo, sem repassar o texto", async () => {
    const cases: [string | undefined, string][] = [
      ["42501", "not_active"],
      ["P0002", "unavailable"],
      ["23505", "already_accepted"],
      ["C7601", "failed"], // a região não é mais exigida (ADR 0011)
      ["C7602", "removed_by_coordination"],
      ["22023", "failed"],
      [undefined, "failed"],
    ];
    for (const [code, error] of cases) {
      const { client } = fakeClient({ error: { code, message: "detalhe interno" } });
      expect(await acceptHouse(client, { houseId: "casa-a", joinMethod: "self" }, houseIds, "termo-1")).toEqual({ ok: false, error });
    }
  });
});

describe("recordConsent", () => {
  it("grava a versão do termo carregada no servidor", async () => {
    const { client, calls } = fakeClient({ data: "2026-11-19T00:00:00Z" });
    expect(await recordConsent(client, { termVersion: "termo-1" }, "termo-1")).toEqual({ ok: true });
    expect(calls).toEqual([{ fn: "record_questionnaire_consent", args: { p_term_version: "termo-1" } }]);
  });

  it("versão diferente da carregada (o termo mudou) pede para recarregar, sem gravar", async () => {
    const { client, calls } = fakeClient();
    expect(await recordConsent(client, { termVersion: "termo-0" }, "termo-1")).toEqual({ ok: false, error: "stale_consent" });
    expect(calls).toEqual([]);
  });

  it("recusa entrada fora do formato e erro do banco vira motivo", async () => {
    const { client, calls } = fakeClient();
    expect(await recordConsent(client, { termVersion: "termo-1", answers: {} }, "termo-1")).toEqual({ ok: false, error: "failed" });
    expect(calls).toEqual([]);
    const denied = fakeClient({ error: { code: "42501" } });
    expect(await recordConsent(denied.client, { termVersion: "termo-1" }, "termo-1")).toEqual({ ok: false, error: "not_active" });
  });
});

describe("readAcceptedHouse", () => {
  it("lê só o próprio vínculo de casa, aberto e aceito, e devolve o id da config", async () => {
    const { client, filters } = fakeClient({ data: { house_key: "casa-b" } });
    expect(await readAcceptedHouse(client, "u1", houseIds)).toBe("casa-b");
    expect(filters).toEqual([
      ["from", "house_members", "house_key"],
      ["eq", "profile_id", "u1"],
      ["is", "left_at", null],
      ["not", "accepted_at", "is", null],
    ]);
  });

  it("sem casa aceita, ou casa que não está na config: null", async () => {
    expect(await readAcceptedHouse(fakeClient().client, "u1", houseIds)).toBeNull();
    expect(await readAcceptedHouse(fakeClient({ data: { house_key: "outra" } }).client, "u1", houseIds)).toBeNull();
  });

  it("erro do banco propaga (a página falha fechada)", async () => {
    await expect(readAcceptedHouse(fakeClient({ error: { code: "42501" } }).client, "u1", houseIds)).rejects.toThrow(
      "house_read_failed",
    );
  });
});

describe("recordQuestionnaireResult", () => {
  it("manda ao banco a casa, o totem e a versão do termo do servidor", async () => {
    const { client, calls } = fakeClient();
    expect(await recordQuestionnaireResult(client, { houseId: "casa-a", totem: "AB" }, houseIds, "termo-1")).toEqual({ ok: true });
    expect(calls).toEqual([
      { fn: "record_questionnaire_result", args: { p_term_version: "termo-1", p_house_key: "casa-a", p_totem: "AB" } },
    ]);
  });

  it("recusa, sem chamar o banco, casa fora da config, totem malformado e campos a mais (respostas, versão)", async () => {
    const { client, calls } = fakeClient();
    for (const input of [
      { houseId: "casa-x", totem: "AB" },
      { houseId: "casa-a", totem: "ab" },
      { houseId: "casa-a", totem: "ABC" },
      { houseId: "casa-a", totem: "AB", answers: { q01: "a" } },
      { houseId: "casa-a", totem: "AB", termVersion: "termo-forjado" },
      { houseId: "casa-a" },
    ]) {
      expect(await recordQuestionnaireResult(client, input, houseIds, "termo-1")).toEqual({ ok: false, error: "failed" });
    }
    expect(calls).toEqual([]);
  });

  it("traduz o erro do banco em motivo da tela", async () => {
    const { client } = fakeClient({ error: { code: "42501" } });
    expect(await recordQuestionnaireResult(client, { houseId: "casa-a", totem: "AB" }, houseIds, "termo-1")).toEqual({
      ok: false,
      error: "not_active",
    });
  });
});

describe("requestHouseAnalysis", () => {
  const itemIds = ["q01", "q02"];

  it("manda ao banco os eixos empatados e as respostas, com a versão do termo do servidor", async () => {
    const { client, calls } = fakeClient();
    const input = { axes: ["house1", "totem2"], answers: { q01: "a", q02: "both" } };
    expect(await requestHouseAnalysis(client, input, itemIds, "termo-1")).toEqual({ ok: true });
    expect(calls).toEqual([
      {
        fn: "request_house_analysis",
        args: { p_term_version: "termo-1", p_tied_axes: ["house1", "totem2"], p_answers: { q01: "a", q02: "both" } },
      },
    ]);
  });

  it("recusa, sem chamar o banco, eixo desconhecido, item que não existe, resposta inválida e campos a mais", async () => {
    const { client, calls } = fakeClient();
    for (const input of [
      { axes: [], answers: { q01: "a" } },
      { axes: ["house9"], answers: { q01: "a" } },
      { axes: ["house1"], answers: { zz: "a" } },
      { axes: ["house1"], answers: { q01: "talvez" } },
      { axes: ["house1"], answers: { q01: "a" }, houseId: "casa-a" },
      { axes: ["house1"] },
      "house1",
    ]) {
      expect(await requestHouseAnalysis(client, input, itemIds, "termo-1")).toEqual({ ok: false, error: "failed" });
    }
    expect(calls).toEqual([]);
  });
});
