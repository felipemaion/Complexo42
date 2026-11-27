import { describe, expect, it } from "vitest";
import { parseQuestionnaire } from "./schema";
import { QuestionnaireAnswerError, scoreQuestionnaire, type Answer, type Answers } from "./score";

// Questionário de teste. Itens intercalados de propósito (a ordem de apresentação não é a ordem
// dos eixos). Eixos 1 e 2: três itens (empate só com "as duas"); totem: dois itens cada, para
// permitir empate 1 × 1.
const raw = {
  version: "teste",
  consentTermVersion: "termo-teste",
  consentTerm: "termo de teste",
  items: ["h1a", "h2a", "t1a", "t2a", "h1b", "h2b", "t1b", "t2b", "h1c", "h2c"].map((id) => ({
    id,
    text: "x",
    a: { text: "x" },
    b: { text: "x" },
  })),
  axes: {
    house1: { itemIds: ["h1a", "h1b", "h1c"], tieBreakItems: ["h1a", "h1b"] },
    house2: { itemIds: ["h2a", "h2b", "h2c"], tieBreakItems: [] },
    totem1: { itemIds: ["t1a", "t1b"], tieBreakItems: [], letters: { a: "X", b: "Y" } },
    totem2: { itemIds: ["t2a", "t2b"], tieBreakItems: [], letters: { a: "V", b: "W" } },
  },
  houseByPoles: { aa: "casa-1", ab: "casa-2", ba: "casa-3", bb: "casa-4" },
};
const houses = ["casa-1", "casa-2", "casa-3", "casa-4"];
const config = parseQuestionnaire(raw, houses);

type Pick = { h1: Answer; h2: Answer; t1: Answer; t2: Answer };

/** Respostas em que todos os itens de cada eixo recebem a resposta pedida. */
function answersFor(pick: Pick): Answers {
  const byAxis = { house1: pick.h1, house2: pick.h2, totem1: pick.t1, totem2: pick.t2 } as const;
  const answers: Record<string, Answer> = {};
  for (const [axis, value] of Object.entries(byAxis)) {
    for (const id of config.axes[axis as keyof typeof byAxis].itemIds) answers[id] = value;
  }
  return answers;
}
const base: Pick = { h1: "a", h2: "a", t1: "a", t2: "a" };

describe("scoreQuestionnaire", () => {
  it.each([
    ["a", "a", "casa-1"],
    ["a", "b", "casa-2"],
    ["b", "a", "casa-3"],
    ["b", "b", "casa-4"],
  ] as const)("eixo 1 = %s e eixo 2 = %s levam à %s", (h1, h2, houseId) => {
    expect(scoreQuestionnaire(config, answersFor({ ...base, h1, h2 }))).toMatchObject({ status: "ok", houseId });
  });

  it.each([
    ["a", "a", "XV"],
    ["a", "b", "XW"],
    ["b", "a", "YV"],
    ["b", "b", "YW"],
  ] as const)("eixo 3 = %s e eixo 4 = %s levam ao totem %s", (t1, t2, totem) => {
    expect(scoreQuestionnaire(config, answersFor({ ...base, t1, t2 }))).toMatchObject({ status: "ok", totem });
  });

  it("a casa não depende do totem e o totem não depende da casa", () => {
    const first = scoreQuestionnaire(config, answersFor({ h1: "a", h2: "b", t1: "b", t2: "a" }));
    const second = scoreQuestionnaire(config, answersFor({ h1: "a", h2: "b", t1: "a", t2: "b" }));
    expect(first).toEqual({ status: "ok", houseId: "casa-2", totem: "YV" });
    expect(second).toEqual({ status: "ok", houseId: "casa-2", totem: "XW" });
  });

  it("conta só os itens do eixo, na ordem do config (não 1..n)", () => {
    // h1a, h1b, h1c = "b" e todo o resto "a": a casa só muda se a contagem seguir `itemIds`.
    const answers: Record<string, Answer> = { ...answersFor(base), h1a: "b", h1b: "b", h1c: "b" };
    expect(scoreQuestionnaire(config, answers)).toMatchObject({ houseId: "casa-3" });
  });

  describe('"as duas"', () => {
    it("vale um ponto para cada polo e deixa a maioria decidir", () => {
      // eixo 1: a + both + both = a 3, b 2 → a
      expect(scoreQuestionnaire(config, { ...answersFor(base), h1b: "both", h1c: "both" })).toMatchObject({ houseId: "casa-1" });
      // eixo 1: b + both + both = a 2, b 3 → b
      expect(scoreQuestionnaire(config, { ...answersFor(base), h1a: "b", h1b: "both", h1c: "both" })).toMatchObject({ houseId: "casa-3" });
    });
  });

  describe("empate e desempate", () => {
    it("empate no eixo 1 desempata pelos tieBreakItems do próprio eixo", () => {
      // a, b, both no eixo 1: a 2 × b 2 → empate; nos itens h1a e h1b, a 1 × b 1 → ainda empata
      const stillTied = { ...answersFor(base), h1a: "a", h1b: "b", h1c: "both" } as const;
      expect(scoreQuestionnaire(config, stillTied)).toEqual({ status: "inconclusive", axes: ["house1"] });
      // h1a = both, h1b = a, h1c = b → a 2 × b 2; desempate (h1a, h1b): a 2 × b 1 → a
      const broken = { ...answersFor(base), h1a: "both", h1b: "a", h1c: "b" } as const;
      expect(scoreQuestionnaire(config, broken)).toMatchObject({ status: "ok", houseId: "casa-1" });
      // h1a = b, h1b = both, h1c = a → a 2 × b 2; desempate: a 1 × b 2 → b
      const brokenToB = { ...answersFor(base), h1a: "b", h1b: "both", h1c: "a" } as const;
      expect(scoreQuestionnaire(config, brokenToB)).toMatchObject({ status: "ok", houseId: "casa-3" });
    });

    it("empate no eixo 2 sem tieBreakItems é inconclusivo e nenhuma casa é atribuída", () => {
      const tie = { ...answersFor(base), h2a: "a", h2b: "b", h2c: "both" } as const;
      expect(scoreQuestionnaire(config, tie)).toEqual({ status: "inconclusive", axes: ["house2"] });
    });

    it.each([
      ["eixo 3", { t1a: "a", t1b: "b" }, ["totem1"]],
      ["eixo 4", { t2a: "a", t2b: "b" }, ["totem2"]],
      ["eixos 3 e 4", { t1a: "a", t1b: "b", t2a: "both", t2b: "both" }, ["totem1", "totem2"]],
    ] as const)("empate no %s é inconclusivo", (_name, override, axes) => {
      expect(scoreQuestionnaire(config, { ...answersFor(base), ...override })).toEqual({ status: "inconclusive", axes });
    });

    it("lista todos os eixos empatados", () => {
      const answers = { ...answersFor(base), h2a: "both", h2b: "both", h2c: "both", t1a: "b", t1b: "a" } as const;
      expect(scoreQuestionnaire(config, answers)).toEqual({ status: "inconclusive", axes: ["house2", "totem1"] });
    });

    it("tudo como \"as duas\" é inconclusivo em todos os eixos", () => {
      expect(scoreQuestionnaire(config, Object.fromEntries(config.items.map((i) => [i.id, "both"])))).toEqual({
        status: "inconclusive",
        axes: ["house1", "house2", "totem1", "totem2"],
      });
    });
  });

  describe("respostas inválidas", () => {
    const complete = answersFor(base);
    const codeOf = (answers: unknown): [string, string[]] | null => {
      try {
        scoreQuestionnaire(config, answers as Answers);
      } catch (err) {
        if (err instanceof QuestionnaireAnswerError) return [err.code, err.itemIds];
        throw err;
      }
      return null;
    };

    it("item sem resposta", () => {
      const partial: Record<string, Answer> = { ...complete };
      delete partial.h2c;
      expect(codeOf(partial)).toEqual(["missing_answer", ["h2c"]]);
    });

    it("resposta para item que não existe", () => {
      expect(codeOf({ ...complete, zz: "a" })).toEqual(["unknown_item", ["zz"]]);
    });

    it("resposta diferente de a, b ou both", () => {
      expect(codeOf({ ...complete, h1a: "c" })).toEqual(["invalid_answer", ["h1a"]]);
      expect(codeOf({ ...complete, h1a: 1 })).toEqual(["invalid_answer", ["h1a"]]);
    });

    it("a mensagem do erro cita só os ids dos itens", () => {
      const secret = { ...complete, h1a: "segredo" } as unknown as Answers;
      expect(() => scoreQuestionnaire(config, secret)).toThrow(/h1a/);
      expect(() => scoreQuestionnaire(config, secret)).not.toThrow(/segredo/);
    });
  });

  it("é pura: não altera as respostas nem o config", () => {
    const answers = answersFor(base);
    const frozen = structuredClone(answers);
    scoreQuestionnaire(config, answers);
    expect(answers).toEqual(frozen);
    expect(scoreQuestionnaire(config, answers)).toEqual(scoreQuestionnaire(config, answers));
  });
});
