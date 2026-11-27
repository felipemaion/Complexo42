import { describe, expect, it, vi } from "vitest";
import { parseQuestionnaire } from "@/modules/questionnaire";
import type { CipherContext, HouseClient } from "../types";
import { compareHouse, type AverageCache, type CompareContext } from "./compare";

const ids = ["h1a", "h1b", "h2a", "h2b", "t1a", "t2a"];
const phrase = (id: string) => ({ a: `Espera ${id} a`, b: `Espera ${id} b` });
const questionnaire = parseQuestionnaire(
  {
    version: "v",
    consentTermVersion: "termo-1",
    consentTerm: "t",
    items: ids.map((id) => ({ id, text: "x", a: { text: "x" }, b: { text: "x" }, ...(id.startsWith("h") ? { expectation: phrase(id) } : {}) })),
    axes: {
      house1: { label: "D1", poleLabels: { a: "a1", b: "b1" }, itemIds: ["h1a", "h1b"] },
      house2: { label: "D2", poleLabels: { a: "a2", b: "b2" }, itemIds: ["h2a", "h2b"] },
      totem1: { label: "D3", poleLabels: { a: "a3", b: "b3" }, itemIds: ["t1a"], letters: { a: "X", b: "Y" } },
      totem2: { label: "D4", poleLabels: { a: "a4", b: "b4" }, itemIds: ["t2a"], letters: { a: "V", b: "W" } },
    },
    houseByPoles: { aa: "casa-a", ab: "casa-b", ba: "casa-c", bb: "casa-d" },
    totemLabels: { XV: { name: "t1", description: "d" }, XW: { name: "t2", description: "d" }, YV: { name: "t3", description: "d" }, YW: { name: "t4", description: "d" } },
  },
  ["casa-a", "casa-b", "casa-c", "casa-d"],
);
// Pessoa: tudo "muito a" (-5) nos eixos da casa e do totem.
const answers = { h1a: -5, h1b: -5, h2a: -5, h2b: -5, t1a: -5, t2a: -5 };

const decrypt = async (value: string, context: CipherContext): Promise<string> => {
  const prefix = `enc[${context.table}.${context.column}.${context.rowId}](`;
  if (!value.startsWith(prefix)) throw new Error("aad_mismatch");
  return value.slice(prefix.length, -1);
};
const row = (id: string, scores: unknown) => ({ profile_id: id, scores_enc: `enc[questionnaire_results.scores_enc.${id}](${JSON.stringify(scores)})` });
const member = (id: string, house1: number, house2: number) => row(id, { house1, house2, totem1: 100, totem2: -100 });

function setup(rows: unknown[] | { error: unknown }, over: Partial<CompareContext> = {}) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const signed: string[] = [];
  const client: HouseClient = {
    rpc: (fn, args) => {
      calls.push({ fn, args });
      return Promise.resolve(Array.isArray(rows) ? { data: rows, error: null } : { data: null, error: rows.error });
    },
    from: () => ({ select: () => { throw new Error("sem leitura direta"); } }) as never,
  };
  const cache: AverageCache = new Map();
  const ctx: CompareContext = {
    questionnaire,
    houseIds: ["casa-a", "casa-b", "casa-c", "casa-d"],
    userId: "u-1",
    nowSeconds: 1000,
    sign: (message) => (signed.push(message), `sig(${message})`),
    decrypt,
    minMembers: 3,
    cache,
    cacheSeconds: 600,
    ...over,
  };
  return { client, calls, signed, ctx, cache };
}
const members = (n: number, house1 = -50, house2 = 30) => Array.from({ length: n }, (_, i) => member(`id-${i}`, house1, house2));

describe("compareHouse", () => {
  it("devolve o que se espera (só dos itens que contradizem a casa) e a média dos membros, arredondada, com n suficiente", async () => {
    const { client, ctx } = setup([member("p1", -48, 33), member("p2", -52, 27), member("p3", -50, 30)]);
    const out = await compareHouse(client, { houseId: "casa-d", answers }, ctx); // casa-d = polo b nos dois eixos
    expect(out).toEqual({
      ok: true,
      expectations: [
        { text: "Espera h1a b", answer: -5 },
        { text: "Espera h1b b", answer: -5 },
        { text: "Espera h2a b", answer: -5 },
        { text: "Espera h2b b", answer: -5 },
      ],
      average: { status: "ok", n: 3, scores: { house1: -50, house2: 30 } },
    });
  });

  it("chama a função com a assinatura do servidor ligada a quem chama e à casa", async () => {
    const { client, calls, signed, ctx } = setup(members(3));
    await compareHouse(client, { houseId: "casa-b", answers }, ctx);
    expect(signed).toEqual(["house_scores|u-1|casa-b|1000"]);
    expect(calls).toEqual([
      { fn: "house_member_scores_enc", args: { p_house_key: "casa-b", p_issued_at: 1000, p_signature: "sig(house_scores|u-1|casa-b|1000)" } },
    ]);
  });

  it("abaixo do mínimo de membros: só 'poucos membros', sem n nem notas", async () => {
    const { client, ctx } = setup(members(2));
    const out = await compareHouse(client, { houseId: "casa-a", answers }, ctx);
    expect(out).toMatchObject({ ok: true, average: { status: "few" } });
    expect(JSON.stringify(out)).not.toMatch(/"n"|scores|-50|30/);
  });

  it("nada de id, nota cifrada nem totem chega ao navegador: a resposta tem só texto, intensidade e o agregado", async () => {
    const { client, ctx } = setup(members(5));
    const text = JSON.stringify(await compareHouse(client, { houseId: "casa-d", answers }, ctx));
    expect(text).not.toMatch(/id-\d|enc\[|totem1|totem2|profile_id/);
  });

  it("linha que não decifra ou não tem o formato é descartada, sem derrubar nem entrar na conta", async () => {
    const rows = [...members(3), { profile_id: "id-x", scores_enc: "enc[outra.coluna.id-x]({})" }, row("id-y", { house1: "lixo" }), { profile_id: 1 }];
    const { client, ctx } = setup(rows);
    const out = await compareHouse(client, { houseId: "casa-a", answers }, ctx);
    expect(out).toMatchObject({ ok: true, average: { status: "ok", n: 3 } });
  });

  it("a média arredonda de 5 em 5 (-48 e -52 viram -50; 33 e 27 viram 30)", async () => {
    const { client, ctx } = setup(members(4, -47, 33));
    const out = await compareHouse(client, { houseId: "casa-a", answers }, ctx);
    expect(out).toMatchObject({ average: { status: "ok", scores: { house1: -45, house2: 35 } } });
  });

  it("cache por casa: uma segunda chamada dentro do prazo não vai ao banco; passado o prazo, vai", async () => {
    const { client, calls, ctx } = setup(members(3));
    await compareHouse(client, { houseId: "casa-a", answers }, ctx);
    await compareHouse(client, { houseId: "casa-a", answers }, { ...ctx, nowSeconds: 1500 });
    expect(calls).toHaveLength(1);
    await compareHouse(client, { houseId: "casa-a", answers }, { ...ctx, nowSeconds: 1700 });
    expect(calls).toHaveLength(2);
    await compareHouse(client, { houseId: "casa-b", answers }, { ...ctx, nowSeconds: 1700 });
    expect(calls).toHaveLength(3);
  });

  it("o cache guarda só o agregado (nada de ids nem notas por pessoa)", async () => {
    const { client, ctx, cache } = setup(members(3));
    await compareHouse(client, { houseId: "casa-a", answers }, ctx);
    expect(JSON.stringify([...cache.entries()])).not.toMatch(/id-\d|enc\[|profile_id/);
  });

  it("erro do banco na média: o que se espera sai mesmo assim e a média fica indisponível", async () => {
    const { client, ctx } = setup({ error: { code: "42501" } });
    const out = await compareHouse(client, { houseId: "casa-d", answers }, ctx);
    expect(out).toMatchObject({ ok: true, average: { status: "unavailable" } });
    expect(out.ok && out.expectations.length).toBe(4);
  });

  it("recusa, sem chamar o banco, casa fora da config, respostas inválidas e campos a mais", async () => {
    const { client, calls, ctx } = setup(members(3));
    for (const input of [
      { houseId: "casa-x", answers },
      { houseId: "casa-a", answers: { ...answers, h1a: 2 } },
      { houseId: "casa-a", answers: { h1a: -5 } },
      { houseId: "casa-a", answers, extra: 1 },
      { answers },
      "x",
    ]) {
      expect(await compareHouse(client, input, ctx)).toEqual({ ok: false, error: "failed" });
    }
    expect(calls).toEqual([]);
  });

  it("a assinatura que falha (sem chave do servidor) falha fechado", async () => {
    const { client, ctx } = setup(members(3), { sign: vi.fn(() => { throw new Error("sem chave"); }) });
    expect(await compareHouse(client, { houseId: "casa-a", answers }, ctx)).toMatchObject({ ok: true, average: { status: "unavailable" } });
  });
});
