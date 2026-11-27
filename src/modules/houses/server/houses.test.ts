import { describe, expect, it } from "vitest";
import type { HouseClient, HouseQuery } from "../types";
import { parseQuestionnaire } from "@/modules/questionnaire";
import { acceptHouse, readAcceptedHouse, recordConsent, submitQuestionnaire } from "./houses";

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

describe("submitQuestionnaire", () => {
  // Chave de teste: dois itens por eixo; a letra de cada polo do totem vem do config.
  const items = ["h1a", "h1b", "h2a", "h2b", "t1a", "t1b", "t2a", "t2b"].map((id) => ({ id, text: "x", a: { text: "x" }, b: { text: "x" } }));
  const questionnaire = parseQuestionnaire(
    {
      version: "v",
      consentTermVersion: "termo-1",
      consentTerm: "t",
      items,
      axes: {
        house1: { itemIds: ["h1a", "h1b"], tieBreakItems: ["h1a"] },
        house2: { itemIds: ["h2a", "h2b"] },
        totem1: { itemIds: ["t1a", "t1b"], letters: { a: "X", b: "Y" } },
        totem2: { itemIds: ["t2a", "t2b"], letters: { a: "V", b: "W" } },
      },
      houseByPoles: { aa: "casa-a", ab: "casa-b", ba: "casa-c", bb: "casa-d" },
    },
    ["casa-a", "casa-b", "casa-c", "casa-d"],
  );
  const signed: string[] = [];
  const ctx = {
    questionnaire,
    houseIds: ["casa-a", "casa-b", "casa-c", "casa-d"],
    userId: "u-1",
    nowSeconds: 1000,
    sign: (message: string) => (signed.push(message), `sig(${message})`),
  };
  const all = (value: "a" | "b" | "both") => Object.fromEntries(items.map((i) => [i.id, value]));

  it("resultado conclusivo: o servidor pontua e manda ao banco casa e totem assinados (para a pessoa da sessão)", async () => {
    const { client, calls } = fakeClient();
    const answers = { ...all("a"), h2a: "b", h2b: "b", t1a: "b", t1b: "b" };
    expect(await submitQuestionnaire(client, { answers }, ctx)).toEqual({ ok: true, outcome: "recorded", houseId: "casa-b" });
    expect(calls).toEqual([
      {
        fn: "record_questionnaire_result",
        args: {
          p_term_version: "termo-1",
          p_house_key: "casa-b",
          p_totem: "YV",
          p_issued_at: 1000,
          p_signature: "sig(result|u-1|termo-1|casa-b|YV|1000)",
        },
      },
    ]);
  });

  it("a resposta ao navegador traz a casa, nunca o totem", async () => {
    const { client } = fakeClient();
    expect(JSON.stringify(await submitQuestionnaire(client, { answers: all("a") }, ctx))).not.toMatch(/AA|XV|totem/);
  });

  it("resultado inconclusivo: abre o pedido de análise com as respostas completas, assinado", async () => {
    const { client, calls } = fakeClient();
    const answers = all("both");
    expect(await submitQuestionnaire(client, { answers }, ctx)).toEqual({ ok: true, outcome: "analysis" });
    expect(calls).toEqual([
      {
        fn: "request_house_analysis",
        args: {
          p_term_version: "termo-1",
          p_tied_axes: ["house1", "house2", "totem1", "totem2"],
          p_answers: answers,
          p_issued_at: 1000,
          p_signature: "sig(analysis|u-1|termo-1|house1,house2,totem1,totem2|1000|8)",
        },
      },
    ]);
  });

  it("recusa, sem chamar o banco nem assinar, respostas incompletas, itens inventados, valores inválidos e campos a mais", async () => {
    const { client, calls } = fakeClient();
    const incomplete: Record<string, "a" | "b" | "both"> = all("a");
    delete incomplete.h1a;
    for (const input of [
      { answers: {} },
      { answers: incomplete },
      { answers: { ...all("a"), zz: "a" } },
      { answers: { ...all("a"), h1a: "talvez" } },
      { answers: all("a"), houseId: "casa-a" },
      { answers: all("a"), totem: "AB" },
      { houseId: "casa-a", totem: "AB" },
      "a",
    ]) {
      expect(await submitQuestionnaire(client, input, ctx)).toEqual({ ok: false, error: "failed" });
    }
    expect(calls).toEqual([]);
    expect(signed.every((m) => !m.includes("talvez"))).toBe(true);
  });

  it("casa fora da config é recusada", async () => {
    const { client, calls } = fakeClient();
    expect(await submitQuestionnaire(client, { answers: all("a") }, { ...ctx, houseIds: ["outra"] })).toEqual({ ok: false, error: "failed" });
    expect(calls).toEqual([]);
  });

  it("traduz o erro do banco: sem permissão, e pedido renovado há pouco", async () => {
    expect(await submitQuestionnaire(fakeClient({ error: { code: "42501" } }).client, { answers: all("a") }, ctx)).toEqual({ ok: false, error: "not_active" });
    expect(await submitQuestionnaire(fakeClient({ error: { code: "54000" } }).client, { answers: all("both") }, ctx)).toEqual({
      ok: false,
      error: "rate_limited",
    });
  });
});
