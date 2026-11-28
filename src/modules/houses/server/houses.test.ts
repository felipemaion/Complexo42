import { describe, expect, it } from "vitest";
import type { HouseClient, HouseQuery } from "../types";
import { parseQuestionnaire } from "@/modules/questionnaire";
import { acceptHouse, readAcceptedHouse, readHouseLock, recordConsent, refusalDetail, submitQuestionnaire, type RefusalDetail } from "./houses";

const houseIds = ["casa-a", "casa-b"];

type Call = { fn: string; args: Record<string, unknown> };

function fakeClient(result: { data?: unknown; error?: unknown; status?: number } = {}) {
  const calls: Call[] = [];
  const filters: unknown[][] = [];
  const response = { data: result.data ?? null, error: result.error ?? null, status: result.status };
  const query: HouseQuery = {
    eq: (...a) => (filters.push(["eq", ...a]), query),
    is: (...a) => (filters.push(["is", ...a]), query),
    not: (...a) => (filters.push(["not", ...a]), query),
    neq: (...a) => (filters.push(["neq", ...a]), query),
    in: (...a) => (filters.push(["in", ...a]), query),
    order: (...a) => (filters.push(["order", ...a]), query),
    limit: (...a) => (filters.push(["limit", ...a]), query),
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
      ["C7603", "house_locked"], // trava de 4 meses para trocar de casa
      ["C7604", "house_conflict"], // troca concorrente
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

describe("motivo técnico da recusa (#313)", () => {
  const refusal = (): { seen: RefusalDetail[]; on: (d: RefusalDetail) => void } => {
    const seen: RefusalDetail[] = [];
    return { seen, on: (d) => seen.push(d) };
  };

  it("refusalDetail guarda só o código do Postgres e o status HTTP, nunca a mensagem", () => {
    expect(refusalDetail({ code: "22023", message: "termo X de Maria", details: "d", hint: "h" }, 400)).toEqual({ code: "22023", status: 400 });
    expect(refusalDetail({ code: "PGRST202" }, 404)).toEqual({ code: "PGRST202", status: 404 });
  });

  it("descarta código fora do formato e status fora de 100-599", () => {
    expect(refusalDetail({ code: "maria@exemplo.org" }, 99)).toEqual({});
    expect(refusalDetail({ code: "x".repeat(40) }, 700)).toEqual({});
    expect(refusalDetail({ code: 42 }, "400")).toEqual({});
    expect(refusalDetail(null, undefined)).toEqual({});
  });

  it("recordConsent recusado pelo banco entrega código e status a quem registra", async () => {
    const { client } = fakeClient({ error: { code: "22023", message: "versão desconhecida" }, status: 400 });
    const r = refusal();
    expect(await recordConsent(client, { termVersion: "termo-1" }, "termo-1", r.on)).toEqual({ ok: false, error: "failed" });
    expect(r.seen).toEqual([{ code: "22023", status: 400 }]);
    expect(JSON.stringify(r.seen)).not.toContain("versão desconhecida");
  });

  it("acceptHouse recusado pelo banco entrega código e status", async () => {
    const { client } = fakeClient({ error: { code: "C7603", message: "detalhe interno" }, status: 400 });
    const r = refusal();
    expect(await acceptHouse(client, { houseId: "casa-a", joinMethod: "self" }, houseIds, "termo-1", r.on)).toEqual({ ok: false, error: "house_locked" });
    expect(r.seen).toEqual([{ code: "C7603", status: 400 }]);
  });

  it("sucesso, entrada inválida e termo desatualizado não chamam o registro (nada foi ao banco)", async () => {
    const ok = fakeClient({ data: "x" });
    const r = refusal();
    await recordConsent(ok.client, { termVersion: "termo-1" }, "termo-1", r.on);
    await recordConsent(ok.client, { termVersion: "termo-0" }, "termo-1", r.on);
    await recordConsent(ok.client, { lixo: 1 }, "termo-1", r.on);
    await acceptHouse(ok.client, { houseId: "outra", joinMethod: "self" }, houseIds, "termo-1", r.on);
    expect(r.seen).toEqual([]);
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
  // Chave de teste: três itens por eixo (ímpar, sem empate); a letra de cada polo do totem vem do config.
  const items = ["h1a", "h1b", "h1c", "h2a", "h2b", "h2c", "t1a", "t1b", "t1c", "t2a", "t2b", "t2c"].map((id) => ({ id, text: "x", a: { text: "x" }, b: { text: "x" } }));
  const questionnaire = parseQuestionnaire(
    {
      version: "v",
      consentTermVersion: "termo-1",
      consentTerm: "t",
      items,
      axes: {
        house1: { label: "D1", poleLabels: { a: "a1", b: "b1" }, itemIds: ["h1a", "h1b", "h1c"] },
        house2: { label: "D2", poleLabels: { a: "a2", b: "b2" }, itemIds: ["h2a", "h2b", "h2c"] },
        totem1: { label: "D3", poleLabels: { a: "a3", b: "b3" }, itemIds: ["t1a", "t1b", "t1c"], letters: { a: "X", b: "Y" } },
        totem2: { label: "D4", poleLabels: { a: "a4", b: "b4" }, itemIds: ["t2a", "t2b", "t2c"], letters: { a: "V", b: "W" } },
      },
      houseByPoles: { aa: "casa-a", ab: "casa-b", ba: "casa-c", bb: "casa-d" },
      totemLabels: { XV: { name: "t1", description: "d" }, XW: { name: "t2", description: "d" }, YV: { name: "t3", description: "d" }, YW: { name: "t4", description: "d" } },
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
    encrypt: async (plaintext: string, context: { table: string; column: string; rowId: string }) =>
      `enc[${context.table}.${context.column}.${context.rowId}](${plaintext})`,
  };
  const all = (value: -5 | -3 | -1 | 1 | 3 | 5) => Object.fromEntries(items.map((i) => [i.id, value]));

  const encScores = (scores: object) => `enc[questionnaire_results.scores_enc.u-1](${JSON.stringify(scores)})`;
  const conclusive = { ...all(-5), h2a: 5, h2b: 5, h2c: 5, t1a: 5, t1b: 5, t1c: 5 };
  const conclusiveScores = { house1: -100, house2: 100, totem1: 100, totem2: -100 };

  it("resultado conclusivo: o servidor pontua e manda ao banco casa, totem e notas cifrados e assinados (para a pessoa da sessão)", async () => {
    const { client, calls } = fakeClient();
    const outcome = await submitQuestionnaire(client, { answers: conclusive }, ctx);
    expect(outcome).toMatchObject({ ok: true, outcome: "recorded", houseId: "casa-b" });
    const totemEnc = "enc[questionnaire_results.totem_enc.u-1](YV)";
    const answersEnc = `enc[questionnaire_results.answers_enc.u-1](${JSON.stringify(conclusive)})`;
    expect(calls).toEqual([
      {
        fn: "record_questionnaire_result",
        args: {
          p_term_version: "termo-1",
          p_house_key: "casa-b",
          p_totem_enc: totemEnc,
          p_scores_enc: encScores(conclusiveScores),
          p_issued_at: 1000,
          // As últimas respostas vão cifradas (AAD da linha da pessoa) e a assinatura as cobre.
          p_signature: `sig(result|u-1|termo-1|casa-b|${totemEnc}|${encScores(conclusiveScores)}|1000|${answersEnc})`,
          p_answers_enc: answersEnc,
        },
      },
    ]);
  });

  it("as respostas guardadas são as da pessoa, cifradas para ela, nunca em texto puro nem na resposta ao navegador", async () => {
    const { client, calls } = fakeClient();
    const outcome = await submitQuestionnaire(client, { answers: conclusive }, ctx);
    const sent = String(calls[0]!.args.p_answers_enc);
    expect(sent.startsWith("enc[questionnaire_results.answers_enc.u-1](")).toBe(true);
    expect(JSON.parse(sent.slice("enc[questionnaire_results.answers_enc.u-1](".length, -1))).toEqual(conclusive);
    expect(JSON.stringify(outcome)).not.toContain("answers_enc");
    expect(signed.at(-1)).toContain(`|${sent}`); // a assinatura cobre o valor cifrado
  });

  it("nem totem, nem notas em texto puro vão ao banco: só os valores cifrados", async () => {
    const { client, calls } = fakeClient();
    await submitQuestionnaire(client, { answers: conclusive }, ctx);
    for (const call of calls) expect(Object.keys(call.args).filter((k) => ["p_totem", "p_scores", "p_answers"].includes(k))).toEqual([]);
  });

  it("a resposta ao navegador traz a casa e o perfil só dos eixos da casa: nunca o totem nem as notas dos outros eixos", async () => {
    const { client } = fakeClient();
    const outcome = await submitQuestionnaire(client, { answers: conclusive }, ctx);
    expect(outcome).toEqual({
      ok: true,
      outcome: "recorded",
      houseId: "casa-b",
      chart: [
        { key: "house1", label: "D1", poleA: "a1", poleB: "b1", score: -100 },
        { key: "house2", label: "D2", poleA: "a2", poleB: "b2", score: 100 },
      ],
      byPoles: { aa: "casa-a", ab: "casa-b", ba: "casa-c", bb: "casa-d" },
      // Token opaco, cifrado para a pessoa (a comparação de casas o usa no lugar das respostas, que o servidor não guarda).
      compareToken: expect.stringMatching(/^enc\[compare_tokens\.answers\.u-1\]\(/),
    });
    expect(JSON.stringify(outcome)).not.toMatch(/YV|totem|D3|D4|a3|b4/);
  });

  it("recusa, sem chamar o banco nem assinar, respostas incompletas, itens inventados, valores fora da escala e campos a mais", async () => {
    const { client, calls } = fakeClient();
    const incomplete: Record<string, number> = all(-3);
    delete incomplete.h1a;
    for (const input of [
      { answers: {} },
      { answers: incomplete },
      { answers: { ...all(-3), zz: -1 } },
      { answers: { ...all(-3), h1a: 0 } },
      { answers: { ...all(-3), h1a: 2 } },
      { answers: { ...all(-3), h1a: 6 } },
      { answers: { ...all(-3), h1a: 1.5 } },
      { answers: { ...all(-3), h1a: "a" } },
      { answers: { ...all(-3), h1a: "talvez" } },
      { answers: all(-3), houseId: "casa-a" },
      { answers: all(-3), totem: "AB" },
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
    expect(await submitQuestionnaire(client, { answers: all(-3) }, { ...ctx, houseIds: ["outra"] })).toEqual({ ok: false, error: "failed" });
    expect(calls).toEqual([]);
  });

  it("traduz o erro do banco: sem permissão, e pedido renovado há pouco", async () => {
    expect(await submitQuestionnaire(fakeClient({ error: { code: "42501" } }).client, { answers: all(-3) }, ctx)).toEqual({ ok: false, error: "not_active" });
    expect(await submitQuestionnaire(fakeClient({ error: { code: "54000" } }).client, { answers: conclusive }, ctx)).toEqual({
      ok: false,
      error: "rate_limited",
    });
  });

  describe("recusa visível (#199)", () => {
    /** Cliente cujo envio é recusado com `code` e cuja leitura do pedido aberto devolve `request`. */
    function refusingClient(code: string, request: { data?: unknown; error?: unknown }) {
      const { client, filters } = fakeClient(request);
      const refusing: HouseClient = { ...client, rpc: () => Promise.resolve({ data: null, error: { code } }) };
      return { client: refusing, filters };
    }

    it("limite de renovação: devolve quantos segundos faltam (1 hora depois da abertura do pedido aberto)", async () => {
      // ctx.nowSeconds = 1000 (1970-01-01T00:16:40Z); o pedido foi aberto em 1970-01-01T00:00:00Z.
      const { client, filters } = refusingClient("54000", { data: { created_at: "1970-01-01T00:00:00Z" } });
      expect(await submitQuestionnaire(client, { answers: conclusive }, ctx)).toEqual({ ok: false, error: "rate_limited", retryAfterSeconds: 3600 - 1000 });
      expect(filters).toContainEqual(["from", "house_analysis_requests", "created_at"]);
      expect(filters).toContainEqual(["eq", "profile_id", "u-1"]);
      expect(filters).toContainEqual(["eq", "status", "open"]);
    });

    it("sem pedido legível (ou já passou de 1 hora): recusa sem tempo, nunca com número inventado", async () => {
      for (const request of [{ data: null }, { error: { code: "42501" } }, { data: { created_at: "lixo" } }, { data: { created_at: "1969-12-31T00:00:00Z" } }]) {
        const { client } = refusingClient("54000", request);
        expect(await submitQuestionnaire(client, { answers: conclusive }, ctx)).toEqual({ ok: false, error: "rate_limited" });
      }
    });

    it("o resultado conclusivo nunca consulta o limite: um erro dele não vira 'limite'", async () => {
      const { client, filters } = refusingClient("42501", {});
      expect(await submitQuestionnaire(client, { answers: conclusive }, ctx)).toEqual({ ok: false, error: "not_active" });
      expect(filters.filter((f) => f[0] === "from")).toEqual([]);
    });

    it("termo da pessoa que o banco não reconhece (22023): pede para ler o termo de novo, não 'falha'", async () => {
      const { client } = refusingClient("22023", {});
      expect(await submitQuestionnaire(client, { answers: conclusive }, ctx)).toEqual({ ok: false, error: "stale_consent" });
    });
  });
});

describe("readHouseLock", () => {
  it("lê só a trava do vínculo aberto e aceito da própria pessoa", async () => {
    const { client, filters } = fakeClient({ data: { locked_until: "2027-03-27T15:00:00+00:00" } });
    expect(await readHouseLock(client, "u1")).toBe("2027-03-27T15:00:00+00:00");
    expect(filters).toContainEqual(["from", "house_members", "locked_until"]);
    expect(filters).toContainEqual(["eq", "profile_id", "u1"]);
    expect(filters).toContainEqual(["is", "left_at", null]);
  });

  it("sem casa aceita, devolve nulo", async () => {
    expect(await readHouseLock(fakeClient().client, "u1")).toBeNull();
  });
});
