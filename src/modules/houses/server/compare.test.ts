import { describe, expect, it, vi } from "vitest";
import { parseQuestionnaire } from "@/modules/questionnaire";
import type { CipherContext, HouseClient } from "../types";
import { compareHouse, openCompareToken, sealCompareToken, sealScoresToken, type AverageCache, type CompareContext, type RateLimiter } from "./compare";

const ids = ["h1a", "h1b", "h1c", "h2a", "h2b", "h2c", "t1a", "t2a"];
const phrase = (id: string) => ({ a: `Espera ${id} a`, b: `Espera ${id} b` });
const questionnaire = parseQuestionnaire(
  {
    version: "v",
    consentTermVersion: "termo-1",
    consentTerm: "t",
    items: ids.map((id) => ({ id, text: "x", a: { text: "x" }, b: { text: "x" }, ...(id.startsWith("h") ? { expectation: phrase(id) } : {}) })),
    axes: {
      house1: { label: "D1", poleLabels: { a: "a1", b: "b1" }, itemIds: ["h1a", "h1b", "h1c"], expectation: { a: "Eixo 1 a", b: "Eixo 1 b" } },
      house2: { label: "D2", poleLabels: { a: "a2", b: "b2" }, itemIds: ["h2a", "h2b", "h2c"], expectation: { a: "Eixo 2 a", b: "Eixo 2 b" } },
      totem1: { label: "D3", poleLabels: { a: "a3", b: "b3" }, itemIds: ["t1a"], letters: { a: "X", b: "Y" } },
      totem2: { label: "D4", poleLabels: { a: "a4", b: "b4" }, itemIds: ["t2a"], letters: { a: "V", b: "W" } },
    },
    houseByPoles: { aa: "casa-a", ab: "casa-b", ba: "casa-c", bb: "casa-d" },
    totemLabels: { XV: { name: "t1", description: "d" }, XW: { name: "t2", description: "d" }, YV: { name: "t3", description: "d" }, YW: { name: "t4", description: "d" } },
  },
  ["casa-a", "casa-b", "casa-c", "casa-d"],
);
// Pessoa: tudo "muito a" (-5) nos eixos da casa e do totem.
const answers = { h1a: -5, h1b: -5, h1c: -5, h2a: -5, h2b: -5, h2c: -5, t1a: -5, t2a: -5 };

const decrypt = async (value: string, context: CipherContext): Promise<string> => {
  const prefix = `enc[${context.table}.${context.column}.${context.rowId}](`;
  if (!value.startsWith(prefix)) throw new Error("aad_mismatch");
  return value.slice(prefix.length, -1);
};
const row = (id: string, scores: unknown) => ({ profile_id: id, scores_enc: `enc[questionnaire_results.scores_enc.${id}](${JSON.stringify(scores)})` });
const member = (id: string, house1: number, house2: number) => row(id, { house1, house2, totem1: 100, totem2: -100 });

const encrypt = async (plain: string, c: CipherContext) => `enc[${c.table}.${c.column}.${c.rowId}](${plain})`;
const tokenFor = (userId = "u-1", at = 1000, forAnswers: Record<string, number> = answers) => sealCompareToken(forAnswers as never, userId, at, encrypt);
const allowAll: RateLimiter = { allow: () => true };

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
    inflight: new Map(),
    failureSeconds: 10,
    tokenSeconds: 1800,
    limiter: allowAll,
    ...over,
  };
  return { client, calls, signed, ctx, cache };
}
const members = (n: number, house1 = -50, house2 = 30) => Array.from({ length: n }, (_, i) => member(`id-${i}`, house1, house2));

describe("compareHouse", () => {
  it("devolve o que se espera (só dos itens que contradizem a casa) e a média dos membros, arredondada, com n suficiente", async () => {
    const { client, ctx } = setup([member("p1", -48, 33), member("p2", -52, 27), member("p3", -50, 30)]);
    const out = await compareHouse(client, { houseId: "casa-d", token: await tokenFor() }, ctx); // casa-d = polo b nos dois eixos
    expect(out).toEqual({
      ok: true,
      expectations: [
        { text: "Espera h1a b", answer: -5 },
        { text: "Espera h1b b", answer: -5 },
        { text: "Espera h1c b", answer: -5 },
        { text: "Espera h2a b", answer: -5 },
        { text: "Espera h2b b", answer: -5 },
        { text: "Espera h2c b", answer: -5 },
      ],
      average: { status: "ok", scores: { house1: -50, house2: 30 } },
    });
  });

  it("chama a função com a assinatura do servidor ligada a quem chama e à casa", async () => {
    const { client, calls, signed, ctx } = setup(members(3));
    await compareHouse(client, { houseId: "casa-b", token: await tokenFor() }, ctx);
    expect(signed).toEqual(["house_scores|u-1|casa-b|1000"]);
    expect(calls).toEqual([
      { fn: "house_member_scores_enc", args: { p_house_key: "casa-b", p_issued_at: 1000, p_signature: "sig(house_scores|u-1|casa-b|1000)" } },
    ]);
  });

  it("abaixo do mínimo de membros: só 'poucos membros', sem n nem notas", async () => {
    const { client, ctx } = setup(members(2));
    const out = await compareHouse(client, { houseId: "casa-a", token: await tokenFor() }, ctx);
    expect(out).toMatchObject({ ok: true, average: { status: "few" } });
    expect(JSON.stringify(out)).not.toMatch(/"n"|scores|-50|30/);
  });

  it("nada de id, nota cifrada nem totem chega ao navegador: a resposta tem só texto, intensidade e o agregado", async () => {
    const { client, ctx } = setup(members(5));
    const text = JSON.stringify(await compareHouse(client, { houseId: "casa-d", token: await tokenFor() }, ctx));
    expect(text).not.toMatch(/id-\d|enc\[|totem1|totem2|profile_id/);
  });

  it("linha que não decifra ou não tem o formato é descartada, sem derrubar nem entrar na conta", async () => {
    const rows = [...members(3), { profile_id: "id-x", scores_enc: "enc[outra.coluna.id-x]({})" }, row("id-y", { house1: "lixo" }), { profile_id: 1 }];
    const { client, ctx } = setup(rows);
    const out = await compareHouse(client, { houseId: "casa-a", token: await tokenFor() }, ctx);
    expect(out).toMatchObject({ ok: true, average: { status: "ok" } });
    expect(JSON.stringify(out)).not.toMatch(/"n"/);
  });

  it("a média arredonda de 5 em 5 (-48 e -52 viram -50; 33 e 27 viram 30)", async () => {
    const { client, ctx } = setup(members(4, -47, 33));
    const out = await compareHouse(client, { houseId: "casa-a", token: await tokenFor() }, ctx);
    expect(out).toMatchObject({ average: { status: "ok", scores: { house1: -45, house2: 35 } } });
  });

  it("cache por casa: uma segunda chamada dentro do prazo não vai ao banco; passado o prazo, vai", async () => {
    const { client, calls, ctx } = setup(members(3));
    await compareHouse(client, { houseId: "casa-a", token: await tokenFor() }, ctx);
    await compareHouse(client, { houseId: "casa-a", token: await tokenFor() }, { ...ctx, nowSeconds: 1500 });
    expect(calls).toHaveLength(1);
    await compareHouse(client, { houseId: "casa-a", token: await tokenFor() }, { ...ctx, nowSeconds: 1700 });
    expect(calls).toHaveLength(2);
    await compareHouse(client, { houseId: "casa-b", token: await tokenFor() }, { ...ctx, nowSeconds: 1700 });
    expect(calls).toHaveLength(3);
  });

  it("o cache guarda só o agregado (nada de ids nem notas por pessoa)", async () => {
    const { client, ctx, cache } = setup(members(3));
    await compareHouse(client, { houseId: "casa-a", token: await tokenFor() }, ctx);
    expect(JSON.stringify([...cache.entries()])).not.toMatch(/id-\d|enc\[|profile_id/);
  });

  it("erro do banco na média: o que se espera sai mesmo assim e a média fica indisponível", async () => {
    const { client, ctx } = setup({ error: { code: "42501" } });
    const out = await compareHouse(client, { houseId: "casa-d", token: await tokenFor() }, ctx);
    expect(out).toMatchObject({ ok: true, average: { status: "unavailable" } });
    expect(out.ok && out.expectations.length).toBe(6);
  });

  it("recusa, sem chamar o banco, casa fora da config, campos a mais (respostas vindas do navegador) e token inválido", async () => {
    const { client, calls, ctx } = setup(members(3));
    const token = await tokenFor();
    for (const input of [
      { houseId: "casa-x", token },
      { houseId: "casa-a", token, answers },
      { houseId: "casa-a", answers },
      { houseId: "casa-a" },
      { houseId: "casa-a", token: "lixo" },
      { token },
      "x",
    ]) {
      expect(await compareHouse(client, input, ctx)).toEqual({ ok: false, error: "failed" });
    }
    expect(calls).toEqual([]);
  });

  it("respostas forjadas no navegador são ignoradas: só vale o token que o servidor selou ao pontuar", async () => {
    const { client, ctx } = setup(members(3));
    // O navegador não consegue fabricar um token (cifrado pelo servidor) nem trocar o de outra pessoa.
    const forged = await compareHouse(client, { houseId: "casa-d", token: JSON.stringify({ a: { h1a: 5 }, t: 1000 }) }, ctx);
    expect(forged).toEqual({ ok: false, error: "failed" });
    const other = await tokenFor("u-2");
    expect(await compareHouse(client, { houseId: "casa-d", token: other }, ctx)).toEqual({ ok: false, error: "failed" });
  });

  it("o token vence: passado o prazo, é recusado (o servidor não guarda as respostas)", async () => {
    const { client, ctx } = setup(members(3), { tokenSeconds: 1800 });
    const token = await tokenFor("u-1", 1000);
    expect(await compareHouse(client, { houseId: "casa-a", token }, { ...ctx, nowSeconds: 1000 + 1799 })).toMatchObject({ ok: true });
    expect(await compareHouse(client, { houseId: "casa-a", token }, { ...ctx, nowSeconds: 1000 + 1801 })).toEqual({ ok: false, error: "failed" });
  });

  it("o token sela só as respostas e nunca o id em claro: o conteúdo é cifrado para a pessoa", async () => {
    const token = await tokenFor();
    expect(token.startsWith("enc[compare_tokens.answers.u-1](")).toBe(true);
    expect(await openCompareToken(token, "u-1", 1000, 1800, decrypt)).toEqual(answers);
    expect(await openCompareToken(token, "u-2", 1000, 1800, decrypt)).toBeNull();
  });

  it("limite por pessoa: passado o teto, recusa sem ir ao banco", async () => {
    const hits: string[] = [];
    const limiter: RateLimiter = { allow: (userId) => (hits.push(userId), hits.length <= 2) };
    const { client, calls, ctx } = setup(members(3), { limiter });
    const token = await tokenFor();
    expect(await compareHouse(client, { houseId: "casa-a", token }, ctx)).toMatchObject({ ok: true });
    expect(await compareHouse(client, { houseId: "casa-b", token }, ctx)).toMatchObject({ ok: true });
    expect(await compareHouse(client, { houseId: "casa-c", token }, ctx)).toEqual({ ok: false, error: "rate_limited" });
    expect(calls).toHaveLength(2);
    expect(hits).toEqual(["u-1", "u-1", "u-1"]);
  });

  it("falha do banco é guardada por alguns segundos: nova tentativa dentro do prazo não volta ao banco", async () => {
    const { client, calls, ctx } = setup({ error: { code: "XX" } });
    const token = await tokenFor();
    await compareHouse(client, { houseId: "casa-a", token }, ctx);
    await compareHouse(client, { houseId: "casa-a", token }, { ...ctx, nowSeconds: 1005 });
    expect(calls).toHaveLength(1);
    await compareHouse(client, { houseId: "casa-a", token }, { ...ctx, nowSeconds: 1011 });
    expect(calls).toHaveLength(2);
  });

  it("várias chamadas ao mesmo tempo para a mesma casa dividem uma consulta só (sem avalanche)", async () => {
    const { client, calls, ctx } = setup(members(3));
    const token = await tokenFor();
    const outs = await Promise.all(Array.from({ length: 5 }, () => compareHouse(client, { houseId: "casa-a", token }, ctx)));
    expect(calls).toHaveLength(1);
    expect(outs.every((out) => out.ok)).toBe(true);
  });

  it("avisa só a contagem de linhas que não decifraram, nunca valor nem id", async () => {
    const skipped: number[] = [];
    const rows = [...members(3), { profile_id: "id-x", scores_enc: "enc[outra.coluna.id-x]({})" }, row("id-y", { house1: "lixo" })];
    const { client, ctx } = setup(rows, { onSkipped: (count) => skipped.push(count) });
    await compareHouse(client, { houseId: "casa-a", token: await tokenFor() }, ctx);
    expect(skipped).toEqual([2]);
  });

  it("a assinatura que falha (sem chave do servidor) falha fechado", async () => {
    const { client, ctx } = setup(members(3), { sign: vi.fn(() => { throw new Error("sem chave"); }) });
    expect(await compareHouse(client, { houseId: "casa-a", token: await tokenFor() }, ctx)).toMatchObject({ ok: true, average: { status: "unavailable" } });
  });
});

describe("compareHouse com o token de notas (sem respostas guardadas, #268)", () => {
  const scoresToken = (userId = "u-1", at = 1000) => sealScoresToken({ house1: -80, house2: 20, totem1: 10, totem2: -10 }, userId, at, encrypt);

  it("usa as frases gerais por eixo, dos eixos do lado oposto ao da casa, da nota mais forte para a mais leve", async () => {
    const { client, ctx } = setup(members(3));
    const out = await compareHouse(client, { houseId: "casa-d", token: await scoresToken() }, ctx); // casa-d = b/b: eixo 1 (-80) e eixo 2 (+20)
    expect(out).toMatchObject({ ok: true, expectations: [{ text: "Eixo 1 b", answer: -5 }] });
  });

  it("a média e os limites são os mesmos do token de respostas (média real, rate limit, token de outra pessoa recusado)", async () => {
    const { client, ctx } = setup(members(3, -50, 30));
    const ok = await compareHouse(client, { houseId: "casa-a", token: await scoresToken() }, ctx);
    expect(ok).toMatchObject({ ok: true, average: { status: "ok", scores: { house1: -50, house2: 30 } } });
    expect(await compareHouse(client, { houseId: "casa-a", token: await scoresToken("u-2") }, ctx)).toEqual({ ok: false, error: "failed" });
    const limited = setup(members(3), { limiter: { allow: () => false } });
    expect(await compareHouse(limited.client, { houseId: "casa-a", token: await scoresToken() }, limited.ctx)).toEqual({ ok: false, error: "rate_limited" });
  });

  it("o token de notas não vira respostas (openCompareToken só abre token de respostas) e o de respostas segue valendo", async () => {
    expect(await openCompareToken(await scoresToken(), "u-1", 1000, 1800, decrypt)).toBeNull();
    expect(await openCompareToken(await tokenFor(), "u-1", 1000, 1800, decrypt)).toEqual(answers);
  });

  it("token vencido ou com nota fora do intervalo é recusado", async () => {
    const { client, ctx } = setup(members(3));
    expect(await compareHouse(client, { houseId: "casa-a", token: await scoresToken("u-1", -900) }, ctx)).toEqual({ ok: false, error: "failed" });
    const bad = await sealScoresToken({ house1: 900, house2: 0, totem1: 0, totem2: 0 }, "u-1", 1000, encrypt);
    expect(await compareHouse(client, { houseId: "casa-a", token: bad }, ctx)).toEqual({ ok: false, error: "failed" });
  });
});

describe("compareHouse: token vencido pede para recarregar (follow-up #270)", () => {
  it("token legítimo e vencido → erro expired (a tela manda recarregar); inválido ou de outra pessoa continua failed", async () => {
    const { client, ctx } = setup(members(3));
    const expired = await sealCompareToken(answers as never, "u-1", -900, encrypt);
    expect(await compareHouse(client, { houseId: "casa-a", token: expired }, ctx)).toEqual({ ok: false, error: "expired" });
    const expiredScores = await sealScoresToken({ house1: 10, house2: 10 }, "u-1", -900, encrypt);
    expect(await compareHouse(client, { houseId: "casa-a", token: expiredScores }, ctx)).toEqual({ ok: false, error: "expired" });
    expect(await compareHouse(client, { houseId: "casa-a", token: await sealCompareToken(answers as never, "u-2", -900, encrypt) }, ctx)).toEqual({ ok: false, error: "failed" });
    expect(await compareHouse(client, { houseId: "casa-a", token: "lixo" }, ctx)).toEqual({ ok: false, error: "failed" });
  });

  it("vencido não gasta o limite nem consulta o banco", async () => {
    const { client, calls, ctx } = setup(members(3), { limiter: { allow: () => { throw new Error("não deveria contar"); } } });
    await compareHouse(client, { houseId: "casa-a", token: await sealCompareToken(answers as never, "u-1", -900, encrypt) }, ctx);
    expect(calls).toEqual([]);
  });
});
