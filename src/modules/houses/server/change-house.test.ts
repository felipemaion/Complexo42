// Tela "Trocar de casa" (#268): o servidor monta a base da comparação a partir do que está guardado (resultado + respostas
// cifradas da própria pessoa). O navegador não manda respostas; o que volta é o perfil, a casa sugerida e um token selado.
import { describe, expect, it } from "vitest";
import { parseQuestionnaire } from "@/modules/questionnaire";
import type { CipherContext, HouseClient } from "../types";
import { openCompareBasis } from "./compare-token";
import { loadChangeHouse, type ChangeHouseContext } from "./change-house";

const ids = ["h1a", "h1b", "h1c", "h2a", "h2b", "h2c", "t1a", "t2a"];
const questionnaire = parseQuestionnaire(
  {
    version: "v",
    consentTermVersion: "termo-1",
    consentTerm: "t",
    items: ids.map((id) => ({ id, text: "x", a: { text: "x" }, b: { text: "x" }, ...(id.startsWith("h") ? { expectation: { a: `${id} a`, b: `${id} b` } } : {}) })),
    axes: {
      house1: { label: "D1", poleLabels: { a: "a1", b: "b1" }, itemIds: ["h1a", "h1b", "h1c"], expectation: { a: "E1 a", b: "E1 b" } },
      house2: { label: "D2", poleLabels: { a: "a2", b: "b2" }, itemIds: ["h2a", "h2b", "h2c"], expectation: { a: "E2 a", b: "E2 b" } },
      totem1: { label: "D3", poleLabels: { a: "a3", b: "b3" }, itemIds: ["t1a"], letters: { a: "X", b: "Y" } },
      totem2: { label: "D4", poleLabels: { a: "a4", b: "b4" }, itemIds: ["t2a"], letters: { a: "V", b: "W" } },
    },
    houseByPoles: { aa: "casa-a", ab: "casa-b", ba: "casa-c", bb: "casa-d" },
    totemLabels: { XV: { name: "t1", description: "d" }, XW: { name: "t2", description: "d" }, YV: { name: "t3", description: "d" }, YW: { name: "t4", description: "d" } },
  },
  ["casa-a", "casa-b", "casa-c", "casa-d"],
);

const aad = (c: CipherContext) => `${c.table}.${c.column}.${c.rowId}`;
const encrypt = async (plain: string, c: CipherContext) => `enc[${aad(c)}](${plain})`;
const decrypt = async (value: string, c: CipherContext) => {
  const prefix = `enc[${aad(c)}](`;
  if (!value.startsWith(prefix)) throw new Error("aad_mismatch");
  return value.slice(prefix.length, -1);
};
const scores = { house1: -60, house2: 40, totem1: 10, totem2: -10 };
const savedAnswers = { h1a: -5, h1b: -3, h1c: -1, h2a: 5, h2b: 3, h2c: 1, t1a: 1, t2a: -1 };

type Stored = { result?: { house_key: string; scores_enc: string } | null; answers?: string | null; readError?: boolean; rpcError?: boolean };
function setup(stored: Stored, failures: string[] = []) {
  const rpcs: string[] = [];
  const from: string[] = [];
  const client: HouseClient = {
    rpc: (fn) => {
      rpcs.push(fn);
      return Promise.resolve(stored.rpcError ? { data: null, error: { code: "42501" } } : { data: stored.answers ?? null, error: null });
    },
    from: (table) => {
      from.push(table);
      const query = { eq: () => query, maybeSingle: () => Promise.resolve(stored.readError ? { data: null, error: { code: "x" } } : { data: stored.result ?? null, error: null }) };
      return { select: () => query as never };
    },
  };
  const ctx: ChangeHouseContext = { questionnaire, houseIds: ["casa-a", "casa-b", "casa-c", "casa-d"], userId: "u-1", nowSeconds: 1000, encrypt, decrypt, onFailure: (reason) => failures.push(reason) };
  return { client, ctx, rpcs, from };
}
const resultRow = (house = "casa-b") => ({ house_key: house, scores_enc: `enc[questionnaire_results.scores_enc.u-1](${JSON.stringify(scores)})` });
const answersEnc = (value: unknown = savedAnswers) => `enc[questionnaire_results.answers_enc.u-1](${JSON.stringify(value)})`;

describe("loadChangeHouse", () => {
  it("com respostas guardadas: casa sugerida, perfil dos eixos da casa e um token de RESPOSTAS (expectativa por pergunta)", async () => {
    const { client, ctx, rpcs } = setup({ result: resultRow(), answers: answersEnc() });
    const view = await loadChangeHouse(client, ctx);
    expect(view.suggestedId).toBe("casa-b");
    expect(view.chart?.map((axis) => [axis.key, axis.score])).toEqual([["house1", -60], ["house2", 40]]);
    expect(view.byPoles).toEqual(questionnaire.houseByPoles);
    expect(rpcs).toEqual(["own_questionnaire_answers_enc"]);
    expect(await openCompareBasis(view.compareToken!, "u-1", 1000, 1800, decrypt)).toEqual({ kind: "answers", answers: savedAnswers });
  });

  it("sem respostas guardadas (respondeu antes): token de NOTAS dos eixos da casa, nunca do totem", async () => {
    const { client, ctx } = setup({ result: resultRow(), answers: null });
    const view = await loadChangeHouse(client, ctx);
    expect(await openCompareBasis(view.compareToken!, "u-1", 1000, 1800, decrypt)).toEqual({ kind: "scores", scores: { house1: -60, house2: 40 } });
  });

  it("respostas ilegíveis (outra pessoa, adulteradas, formato errado) caem nas notas, sem erro", async () => {
    for (const answers of ["enc[questionnaire_results.answers_enc.outra](x)", answersEnc({ h1a: 7 }), answersEnc("texto")]) {
      const view = await loadChangeHouse(setup({ result: resultRow(), answers }).client, setup({}).ctx);
      expect(await openCompareBasis(view.compareToken!, "u-1", 1000, 1800, decrypt)).toMatchObject({ kind: "scores" });
    }
  });

  it("falha ao ler as respostas (função) também cai nas notas", async () => {
    const view = await loadChangeHouse(...(() => { const s = setup({ result: resultRow(), rpcError: true }); return [s.client, s.ctx] as const; })());
    expect(await openCompareBasis(view.compareToken!, "u-1", 1000, 1800, decrypt)).toMatchObject({ kind: "scores" });
  });

  it("sem resultado do questionário (escolheu a casa direto): sem gráfico, sem token, e nem lê as respostas", async () => {
    const { client, ctx, rpcs } = setup({ result: null });
    expect(await loadChangeHouse(client, ctx)).toEqual({});
    expect(rpcs).toEqual([]);
  });

  it("erro de leitura, notas ilegíveis ou casa fora da config: tela sem comparação (nada de erro nem de dado parcial)", async () => {
    expect(await loadChangeHouse(...(() => { const s = setup({ readError: true }); return [s.client, s.ctx] as const; })())).toEqual({});
    const broken = setup({ result: { house_key: "casa-b", scores_enc: "lixo" } });
    expect(await loadChangeHouse(broken.client, broken.ctx)).toEqual({});
    const unknown = setup({ result: resultRow("casa-x"), answers: answersEnc() });
    expect(await loadChangeHouse(unknown.client, unknown.ctx)).toEqual({});
  });

  it("não devolve totem, notas fora dos eixos da casa nem respostas em claro ao navegador", async () => {
    const { client, ctx } = setup({ result: resultRow(), answers: answersEnc() });
    const view = await loadChangeHouse(client, ctx);
    // O token é selado (cifrado) no servidor; neste teste o cifrador é falso e deixa o conteúdo legível, então fica de fora.
    const visible = { ...view };
    delete visible.compareToken;
    const text = JSON.stringify(visible);
    expect(text).not.toContain("totem");
    expect(text).not.toContain("h1a");
    expect(view.chart?.every((axis) => axis.key === "house1" || axis.key === "house2")).toBe(true);
  });
});

describe("loadChangeHouse: log só com o código do motivo (follow-up #270)", () => {
  it("erro de leitura do resultado → só o código read_failed (nada de mensagem, id ou valor)", async () => {
    const failures: string[] = [];
    const { client, ctx } = setup({ readError: true }, failures);
    await loadChangeHouse(client, ctx);
    expect(failures).toEqual(["read_failed"]);
  });

  it("notas que não decifram → só o código result_unreadable", async () => {
    const failures: string[] = [];
    const { client, ctx } = setup({ result: { house_key: "casa-b", scores_enc: "lixo-com-dado-sensivel" } }, failures);
    await loadChangeHouse(client, ctx);
    expect(failures).toEqual(["result_unreadable"]);
    expect(JSON.stringify(failures)).not.toContain("lixo");
  });

  it("sem resultado (escolheu a casa direto) e leitura boa: nada a registrar", async () => {
    const failures: string[] = [];
    await loadChangeHouse(...(() => { const s = setup({ result: null }, failures); return [s.client, s.ctx] as const; })());
    await loadChangeHouse(...(() => { const s = setup({ result: resultRow(), answers: null }, failures); return [s.client, s.ctx] as const; })());
    expect(failures).toEqual([]);
  });
});

describe("loadChangeHouse: nenhuma chave totem* (follow-up #270)", () => {
  const keysOf = (value: unknown): string[] =>
    typeof value === "object" && value !== null ? Object.entries(value).flatMap(([key, inner]) => [key, ...keysOf(inner)]) : Array.isArray(value) ? value.flatMap(keysOf) : [];

  it("a view, e o corpo do token (de notas e de respostas), não têm chave totem*", async () => {
    for (const answers of [null, answersEnc()]) {
      const { client, ctx } = setup({ result: resultRow(), answers });
      const view = await loadChangeHouse(client, ctx);
      expect(keysOf(view).filter((key) => key.startsWith("totem"))).toEqual([]);
      const body = JSON.parse(await decrypt(view.compareToken!, { table: "compare_tokens", column: "answers", rowId: "u-1" }));
      expect(keysOf(body).filter((key) => key.startsWith("totem"))).toEqual([]);
    }
  });
});
