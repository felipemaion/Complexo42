import { describe, expect, it } from "vitest";
import { parseQuestionnaire } from "./schema";
import { answerValues, QuestionnaireAnswerError, scoreQuestionnaire, type Answer, type Answers } from "./score";

// Questionário de teste. Itens intercalados de propósito (a ordem de apresentação não é a ordem
// dos eixos). Eixo 1: quatro itens, desempate por dois deles; eixo 2: três itens, sem desempate;
// totem: dois itens cada, sem desempate.
const itemIds = ["h1a", "h2a", "t1a", "t2a", "h1b", "h2b", "t1b", "t2b", "h1c", "h2c", "h1d"];
const axis = (label: string) => ({ label, poleLabels: { a: `${label}-a`, b: `${label}-b` } });
const raw = {
  version: "teste",
  consentTermVersion: "termo-teste",
  consentTerm: "termo de teste",
  items: itemIds.map((id) => ({ id, text: "x", a: { text: "x" }, b: { text: "x" } })),
  axes: {
    house1: { ...axis("D1"), itemIds: ["h1a", "h1b", "h1c", "h1d"], tieBreakItems: ["h1a", "h1b"] },
    house2: { ...axis("D2"), itemIds: ["h2a", "h2b", "h2c"], tieBreakItems: [] },
    totem1: { ...axis("D3"), itemIds: ["t1a", "t1b"], tieBreakItems: [], letters: { a: "X", b: "Y" } },
    totem2: { ...axis("D4"), itemIds: ["t2a", "t2b"], tieBreakItems: [], letters: { a: "V", b: "W" } },
  },
  houseByPoles: { aa: "casa-1", ab: "casa-2", ba: "casa-3", bb: "casa-4" },
};
const config = parseQuestionnaire(raw, ["casa-1", "casa-2", "casa-3", "casa-4"]);

type Pick = { h1: Answer; h2: Answer; t1: Answer; t2: Answer };

/** Respostas em que todos os itens de cada eixo recebem a mesma resposta. */
function answersFor(pick: Pick): Record<string, Answer> {
  const byAxis = { house1: pick.h1, house2: pick.h2, totem1: pick.t1, totem2: pick.t2 } as const;
  const answers: Record<string, Answer> = {};
  for (const [name, value] of Object.entries(byAxis)) {
    for (const id of config.axes[name as keyof typeof byAxis].itemIds) answers[id] = value;
  }
  return answers;
}
const base: Pick = { h1: -3, h2: -3, t1: -3, t2: -3 };

/** Todos "muito a", com as respostas dadas trocadas (tipadas como respostas da escala). */
const withAnswers = (override: Readonly<Record<string, Answer>>): Record<string, Answer> => ({ ...answersFor(base), ...override });

describe("scoreQuestionnaire", () => {
  it.each([
    [-3, -3, "casa-1"],
    [-1, 2, "casa-2"],
    [3, -2, "casa-3"],
    [1, 1, "casa-4"],
  ] as const)("eixo 1 = %s e eixo 2 = %s (sinal negativo é o polo a) levam à %s", (h1, h2, houseId) => {
    expect(scoreQuestionnaire(config, answersFor({ ...base, h1, h2 }))).toMatchObject({ status: "ok", houseId });
  });

  it.each([
    [-3, -3, "XV"],
    [-2, 1, "XW"],
    [2, -1, "YV"],
    [3, 3, "YW"],
  ] as const)("eixo 3 = %s e eixo 4 = %s levam ao totem %s", (t1, t2, totem) => {
    expect(scoreQuestionnaire(config, answersFor({ ...base, t1, t2 }))).toMatchObject({ status: "ok", totem });
  });

  it("a casa não depende do totem e o totem não depende da casa", () => {
    const first = scoreQuestionnaire(config, answersFor({ h1: -3, h2: 3, t1: 3, t2: -3 }));
    const second = scoreQuestionnaire(config, answersFor({ h1: -3, h2: 3, t1: -3, t2: 3 }));
    expect(first).toMatchObject({ houseId: "casa-2", totem: "YV" });
    expect(second).toMatchObject({ houseId: "casa-2", totem: "XW" });
  });

  it("conta só os itens do eixo, na ordem do config (não 1..n)", () => {
    // Todos os itens do eixo 1 em "muito b" e o resto "muito a": a casa só muda se a soma seguir `itemIds`.
    const answers = withAnswers({ h1a: 3, h1b: 3, h1c: 3, h1d: 3 });
    expect(scoreQuestionnaire(config, answers)).toMatchObject({ houseId: "casa-3" });
  });

  describe("notas dos eixos (média normalizada para -100..100)", () => {
    it("tudo no extremo dá -100 (muito a) e 100 (muito b)", () => {
      expect(scoreQuestionnaire(config, answersFor({ h1: -3, h2: 3, t1: -3, t2: 3 })).scores).toEqual({
        house1: -100,
        house2: 100,
        totem1: -100,
        totem2: 100,
      });
    });

    it("é a média dos itens do eixo, arredondada", () => {
      // eixo 2: -3, -1, 3 → soma -1, média -1/3, nota -11; eixo 1: 1, 2, 3, 3 → média 2,25 → 75.
      const answers = withAnswers({ h2a: -3, h2b: -1, h2c: 3, h1a: 1, h1b: 2, h1c: 3, h1d: 3, t1a: -1, t1b: -2 });
      expect(scoreQuestionnaire(config, answers).scores).toEqual({ house1: 75, house2: -11, totem1: -50, totem2: -100 });
    });

    it("cada intensidade pesa o que vale: 1 é um terço de 3", () => {
      expect(scoreQuestionnaire(config, answersFor({ ...base, t1: 1, t2: -2 })).scores).toMatchObject({ totem1: 33, totem2: -67 });
    });

    it("a nota nunca é -0", () => {
      const scores = scoreQuestionnaire(config, withAnswers({ h2a: -2, h2b: -1, h2c: 3 })).scores;
      expect(Object.is(scores.house2, 0)).toBe(true);
    });

    it("o sinal vem da soma exata, mesmo se a nota arredondar para 0", () => {
      // 100 itens no eixo: soma -1 → nota arredondada 0, mas o polo continua o "a".
      const many = Array.from({ length: 100 }, (_, index) => `m${index}`);
      const big = parseQuestionnaire(
        {
          ...raw,
          items: [...raw.items.filter((i) => !i.id.startsWith("h2")), ...many.map((id) => ({ id, text: "x", a: { text: "x" }, b: { text: "x" } }))],
          axes: { ...raw.axes, house2: { ...axis("D2"), itemIds: many, tieBreakItems: [] } },
        },
        ["casa-1", "casa-2", "casa-3", "casa-4"],
      );
      const answers: Record<string, Answer> = { h1a: -3, h1b: -3, h1c: -3, h1d: -3, t1a: -3, t1b: -3, t2a: -3, t2b: -3 };
      // Monta soma exatamente -1: 50 itens em +1 e 49 em -1 e um em -2.
      many.forEach((id, index) => (answers[id] = index < 50 ? 1 : index < 99 ? -1 : -2));
      const result = scoreQuestionnaire(big, answers);
      expect(result.scores.house2).toBe(0);
      expect(result).toMatchObject({ status: "ok", houseId: "casa-1" });
    });
  });

  describe("empate e desempate", () => {
    it("nota 0 no eixo 1 desempata pela média dos tieBreakItems do próprio eixo", () => {
      // soma 0 (-2, -1, 3, 0 não existe): h1a -2, h1b -1, h1c 3, h1d 0 é inválido; uso -3,-1,2,2 = 0.
      const toA = withAnswers({ h1a: -3, h1b: -1, h1c: 2, h1d: 2 });
      expect(scoreQuestionnaire(config, toA)).toMatchObject({ status: "ok", houseId: "casa-1", scores: { house1: 0 } });
      // desempate (h1a, h1b) = +3 +1 → b
      const toB = withAnswers({ h1a: 3, h1b: 1, h1c: -2, h1d: -2 });
      expect(scoreQuestionnaire(config, toB)).toMatchObject({ status: "ok", houseId: "casa-3", scores: { house1: 0 } });
    });

    it("nota 0 e desempate também 0: inconclusivo, com as notas e sem casa nem totem", () => {
      const tied = withAnswers({ h1a: -1, h1b: 1, h1c: -2, h1d: 2 });
      const result = scoreQuestionnaire(config, tied);
      expect(result).toEqual({ status: "inconclusive", axes: ["house1"], scores: { house1: 0, house2: -100, totem1: -100, totem2: -100 } });
      expect(result).not.toHaveProperty("houseId");
      expect(result).not.toHaveProperty("totem");
    });

    it("nota 0 no eixo 2 sem tieBreakItems é inconclusivo e nenhuma casa é atribuída", () => {
      const tied = withAnswers({ h2a: -2, h2b: -1, h2c: 3 });
      expect(scoreQuestionnaire(config, tied)).toMatchObject({ status: "inconclusive", axes: ["house2"] });
    });

    it.each([
      ["eixo 3", { t1a: -2, t1b: 2 }, ["totem1"]],
      ["eixo 4", { t2a: 1, t2b: -1 }, ["totem2"]],
      ["eixos 3 e 4", { t1a: -3, t1b: 3, t2a: 2, t2b: -2 }, ["totem1", "totem2"]],
    ] as const)("empate no %s é inconclusivo", (_name, override, axes) => {
      expect(scoreQuestionnaire(config, withAnswers({ ...override }))).toMatchObject({ status: "inconclusive", axes });
    });

    it("lista todos os eixos empatados", () => {
      const answers = withAnswers({ h2a: -2, h2b: -1, h2c: 3, t1a: 3, t1b: -3 });
      expect(scoreQuestionnaire(config, answers)).toMatchObject({ status: "inconclusive", axes: ["house2", "totem1"] });
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
      expect(codeOf({ ...complete, zz: -1 })).toEqual(["unknown_item", ["zz"]]);
    });

    it.each([0, 4, -4, 1.5, -0.5, "a", "1", null, true, NaN])("resposta fora de -3, -2, -1, 1, 2 e 3 (%s) é recusada", (value) => {
      expect(codeOf({ ...complete, h1a: value })).toEqual(["invalid_answer", ["h1a"]]);
    });

    it("a mensagem do erro cita só os ids dos itens", () => {
      const secret = { ...complete, h1a: "segredo" } as unknown as Answers;
      expect(() => scoreQuestionnaire(config, secret)).toThrow(/h1a/);
      expect(() => scoreQuestionnaire(config, secret)).not.toThrow(/segredo/);
    });
  });

  it("os seis valores da escala são os únicos aceitos", () => {
    expect([...answerValues]).toEqual([-3, -2, -1, 1, 2, 3]);
  });

  it("é pura: não altera as respostas nem o config", () => {
    const answers = answersFor(base);
    const frozen = structuredClone(answers);
    scoreQuestionnaire(config, answers);
    expect(answers).toEqual(frozen);
    expect(scoreQuestionnaire(config, answers)).toEqual(scoreQuestionnaire(config, answers));
  });
});
