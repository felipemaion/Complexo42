import { describe, expect, it } from "vitest";
import { houseExpectations, missingExpectations } from "./expectations";
import { parseQuestionnaire, toPublicQuestionnaire } from "./schema";
import type { Answer } from "./score";

// Chave de teste: eixo 1 (house1) com h1a h1b h1c, eixo 2 (house2) com h2a h2b h2c; totem com um item cada (sem expectativa).
// Casas: aa casa-1, ab casa-2, ba casa-3, bb casa-4 (polo a do eixo 1 e a do eixo 2 = casa-1).
const ids = ["h1a", "h2a", "t1a", "h1b", "h2b", "t2a", "h1c", "h2c"];
const expectation = (id: string) => ({ a: `Espera-se ${id} no polo a.`, b: `Espera-se ${id} no polo b.` });
const base = {
  version: "teste",
  consentTermVersion: "termo-teste",
  consentTerm: "termo de teste",
  items: ids.map((id) => ({ id, text: `Pergunta ${id}`, a: { text: "a" }, b: { text: "b" }, ...(id.startsWith("h") ? { expectation: expectation(id) } : {}) })),
  axes: {
    house1: { label: "D1", poleLabels: { a: "a1", b: "b1" }, itemIds: ["h1a", "h1b", "h1c"] },
    house2: { label: "D2", poleLabels: { a: "a2", b: "b2" }, itemIds: ["h2a", "h2b", "h2c"] },
    totem1: { label: "D3", poleLabels: { a: "a3", b: "b3" }, itemIds: ["t1a"], letters: { a: "X", b: "Y" } },
    totem2: { label: "D4", poleLabels: { a: "a4", b: "b4" }, itemIds: ["t2a"], letters: { a: "V", b: "W" } },
  },
  houseByPoles: { aa: "casa-1", ab: "casa-2", ba: "casa-3", bb: "casa-4" },
  totemLabels: { XV: { name: "t1", description: "d" }, XW: { name: "t2", description: "d" }, YV: { name: "t3", description: "d" }, YW: { name: "t4", description: "d" } },
};
const houses = ["casa-1", "casa-2", "casa-3", "casa-4"];
const config = parseQuestionnaire(base, houses);
const answers = (over: Record<string, Answer>): Record<string, Answer> => ({
  h1a: -5, h1b: -5, h1c: -5, h2a: -5, h2b: -5, h2c: -5, t1a: 5, t2a: 5, ...over,
});

describe("houseExpectations (o que se espera na casa escolhida)", () => {
  it("só entram os itens em que a resposta foi para o OUTRO polo da casa, com a frase do polo da casa", () => {
    // casa-1 = polo a nos dois eixos. h1b e h2c respondidos para o polo b: contradizem.
    const out = houseExpectations(config, answers({ h1b: 3, h2c: 1 }), "casa-1");
    expect(out.map((e) => e.itemId).sort()).toEqual(["h1b", "h2c"]);
    expect(out.find((e) => e.itemId === "h1b")?.text).toBe("Espera-se h1b no polo a.");
  });

  it("a frase é a do polo da casa em cada eixo (casa-4: polo b nos dois)", () => {
    const out = houseExpectations(config, answers({}), "casa-4"); // tudo respondido para o polo a: tudo contradiz a casa-4
    expect(out).toHaveLength(6);
    expect(out.every((e) => e.text.endsWith("no polo b."))).toBe(true);
  });

  it("os polos vêm do mapa da casa: casa-2 (a no eixo 1, b no eixo 2)", () => {
    const out = houseExpectations(config, answers({}), "casa-2");
    // eixo 1 respondido no polo a = igual à casa (não contradiz); eixo 2 respondido no a = contradiz o b.
    expect(out.map((e) => e.itemId).sort()).toEqual(["h2a", "h2b", "h2c"]);
    expect(out.every((e) => e.text.endsWith("no polo b."))).toBe(true);
  });

  it("ordena da contradição mais forte (Totalmente) para a mais fraca; empate, pela ordem das perguntas", () => {
    const out = houseExpectations(config, answers({ h1a: 1, h1b: 5, h1c: 3, h2a: 5 }), "casa-4");
    // contradições com casa-4 (b/b): tudo que foi respondido em a (negativo). h1a=1 (b) não contradiz; h1b=5 (b) idem...
    expect(out.every((e) => e.answer < 0)).toBe(true);
    const strengths = out.map((e) => Math.abs(e.answer));
    expect([...strengths].sort((x, y) => y - x)).toEqual(strengths);
  });

  it("mostra a intensidade da resposta da pessoa", () => {
    const out = houseExpectations(config, answers({ h1a: 5, h1b: 3, h1c: 1 }), "casa-1");
    expect(out.map((e) => [e.itemId, e.answer])).toEqual([
      ["h1a", 5],
      ["h1b", 3],
      ["h1c", 1],
    ]);
  });

  it("item sem frase na config não aparece (nunca inventa frase)", () => {
    const noPhrase = parseQuestionnaire(
      { ...base, items: base.items.map((i) => (i.id === "h1a" ? { id: i.id, text: i.text, a: i.a, b: i.b } : i)) },
      houses,
    );
    const out = houseExpectations(noPhrase, answers({ h1a: 5, h1b: 5 }), "casa-1");
    expect(out.map((e) => e.itemId)).toEqual(["h1b"]);
  });

  it("nada do totem entra, mesmo que a resposta do totem contradiga", () => {
    const out = houseExpectations(config, answers({ t1a: 5, t2a: 5 }), "casa-4");
    expect(out.map((e) => e.itemId)).not.toEqual(expect.arrayContaining(["t1a"]));
    expect(out.every((e) => e.itemId.startsWith("h"))).toBe(true);
  });

  it("casa desconhecida: lista vazia", () => {
    expect(houseExpectations(config, answers({}), "casa-x")).toEqual([]);
  });
});

describe("missingExpectations (config fail closed)", () => {
  it("config completa não falta nada", () => {
    expect(missingExpectations(config)).toEqual([]);
  });

  it("lista os itens dos eixos da casa sem expectativa a e b (o totem não precisa)", () => {
    const partial = parseQuestionnaire(
      { ...base, items: base.items.map((i) => (i.id === "h1b" || i.id === "h2c" ? { id: i.id, text: i.text, a: i.a, b: i.b } : i)) },
      houses,
    );
    expect(missingExpectations(partial)).toEqual(["h1b", "h2c"]);
  });
});

describe("o navegador nunca recebe as frases de expectativa", () => {
  it("toPublicQuestionnaire tira o campo expectation dos itens", () => {
    const pub = toPublicQuestionnaire(config);
    for (const item of pub.items) expect(Object.keys(item).sort()).toEqual(["a", "b", "id", "text"]);
    expect(JSON.stringify(pub)).not.toContain("Espera-se");
  });
});
