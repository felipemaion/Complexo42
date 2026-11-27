import { describe, expect, it } from "vitest";
import { parseQuestionnaire } from "./schema";
import { answerValues, QuestionnaireAnswerError, scoreQuestionnaire, type Answer, type Answers } from "./score";

// Questionário de teste. Itens intercalados de propósito (a ordem de apresentação não é a ordem
// dos eixos). Todo eixo tem número ímpar de itens (a soma nunca é zero): três no eixo 1, cinco no 2,
// três em cada eixo do totem.
const itemIds = ["h1a", "h2a", "t1a", "t2a", "h1b", "h2b", "t1b", "t2b", "h1c", "h2c", "t1c", "t2c", "h2d", "h2e"];
const axis = (label: string) => ({ label, poleLabels: { a: `${label}-a`, b: `${label}-b` } });
const raw = {
  version: "teste",
  consentTermVersion: "termo-teste",
  consentTerm: "termo de teste",
  items: itemIds.map((id) => ({ id, text: "x", a: { text: "x" }, b: { text: "x" } })),
  axes: {
    house1: { ...axis("D1"), itemIds: ["h1a", "h1b", "h1c"] },
    house2: { ...axis("D2"), itemIds: ["h2a", "h2b", "h2c", "h2d", "h2e"] },
    totem1: { ...axis("D3"), itemIds: ["t1a", "t1b", "t1c"], letters: { a: "X", b: "Y" } },
    totem2: { ...axis("D4"), itemIds: ["t2a", "t2b", "t2c"], letters: { a: "V", b: "W" } },
  },
  houseByPoles: { aa: "casa-1", ab: "casa-2", ba: "casa-3", bb: "casa-4" },
  totemLabels: { XV: { name: "t1", description: "d" }, XW: { name: "t2", description: "d" }, YV: { name: "t3", description: "d" }, YW: { name: "t4", description: "d" } },
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
const base: Pick = { h1: -5, h2: -5, t1: -5, t2: -5 };

/** Todos "muito a", com as respostas dadas trocadas (tipadas como respostas da escala). */
const withAnswers = (override: Readonly<Record<string, Answer>>): Record<string, Answer> => ({ ...answersFor(base), ...override });

describe("scoreQuestionnaire", () => {
  it.each([
    [-5, -5, "casa-1"],
    [-1, 3, "casa-2"],
    [5, -3, "casa-3"],
    [1, 1, "casa-4"],
  ] as const)("eixo 1 = %s e eixo 2 = %s (sinal negativo é o polo a) levam à %s", (h1, h2, houseId) => {
    expect(scoreQuestionnaire(config, answersFor({ ...base, h1, h2 }))).toMatchObject({ status: "ok", houseId });
  });

  it.each([
    [-5, -5, "XV"],
    [-3, 1, "XW"],
    [3, -1, "YV"],
    [5, 5, "YW"],
  ] as const)("eixo 3 = %s e eixo 4 = %s levam ao totem %s", (t1, t2, totem) => {
    expect(scoreQuestionnaire(config, answersFor({ ...base, t1, t2 }))).toMatchObject({ status: "ok", totem });
  });

  it("a casa não depende do totem e o totem não depende da casa", () => {
    const first = scoreQuestionnaire(config, answersFor({ h1: -5, h2: 5, t1: 5, t2: -5 }));
    const second = scoreQuestionnaire(config, answersFor({ h1: -5, h2: 5, t1: -5, t2: 5 }));
    expect(first).toMatchObject({ houseId: "casa-2", totem: "YV" });
    expect(second).toMatchObject({ houseId: "casa-2", totem: "XW" });
  });

  it("conta só os itens do eixo, na ordem do config (não 1..n)", () => {
    const answers = withAnswers({ h1a: 5, h1b: 5, h1c: 5 });
    expect(scoreQuestionnaire(config, answers)).toMatchObject({ houseId: "casa-3" });
  });

  it("um item de peso 5 vence dois de peso 1 do lado oposto (a soma decide)", () => {
    expect(scoreQuestionnaire(config, withAnswers({ h1a: 5, h1b: -1, h1c: -1 }))).toMatchObject({ houseId: "casa-3", scores: { house1: 20 } });
    expect(scoreQuestionnaire(config, withAnswers({ h1a: 1, h1b: -3, h1c: 1 }))).toMatchObject({ houseId: "casa-1" });
  });

  describe("notas dos eixos (média normalizada para -100..100)", () => {
    it("tudo no extremo dá -100 (muito a) e 100 (muito b)", () => {
      expect(scoreQuestionnaire(config, answersFor({ h1: -5, h2: 5, t1: -5, t2: 5 })).scores).toEqual({
        house1: -100,
        house2: 100,
        totem1: -100,
        totem2: 100,
      });
    });

    it("é a média dos itens do eixo sobre 5, arredondada", () => {
      // eixo 2: -5, -3, -1, 1, 3 → soma -5, média -1, nota -20; eixo 1: 1, 3, 5 → média 3 → 60.
      const answers = withAnswers({ h2a: -5, h2b: -3, h2c: -1, h2d: 1, h2e: 3, h1a: 1, h1b: 3, h1c: 5, t1a: -1, t1b: -3, t1c: -3 });
      expect(scoreQuestionnaire(config, answers).scores).toEqual({ house1: 60, house2: -20, totem1: -47, totem2: -100 });
    });

    it("os pesos são 1, 3 e 5", () => {
      expect(scoreQuestionnaire(config, answersFor({ ...base, t1: 1, t2: -3 })).scores).toMatchObject({ totem1: 20, totem2: -60 });
    });
  });

  describe("sem empate", () => {
    it("com número ímpar de respostas ímpares a soma nunca é zero: todo resultado é conclusivo", () => {
      const values = [...answerValues];
      let seen = 0;
      for (const a of values) for (const b of values) for (const c of values) {
        const result = scoreQuestionnaire(config, withAnswers({ h1a: a, h1b: b, h1c: c }));
        expect(result.status).toBe("ok");
        expect(result.scores.house1).not.toBe(0);
        seen += 1;
      }
      expect(seen).toBe(216);
    });

    it("não existe mais desempate nem totem pendente: o resultado é sempre a casa e o totem", () => {
      const result = scoreQuestionnaire(config, withAnswers({ h1a: -1, h1b: 1, h1c: -3, t1a: 1, t1b: -1, t1c: 1 }));
      expect(result).toMatchObject({ status: "ok", houseId: "casa-1", totem: "YV" });
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

    it.each([0, 2, -2, 4, -4, 6, -6, 1.5, "a", "1", null, true, NaN])("resposta fora de -5, -3, -1, 1, 3 e 5 (%s) é recusada", (value) => {
      expect(codeOf({ ...complete, h1a: value })).toEqual(["invalid_answer", ["h1a"]]);
    });

    it("a mensagem do erro cita só os ids dos itens", () => {
      const secret = { ...complete, h1a: "segredo" } as unknown as Answers;
      expect(() => scoreQuestionnaire(config, secret)).toThrow(/h1a/);
      expect(() => scoreQuestionnaire(config, secret)).not.toThrow(/segredo/);
    });
  });

  it("os seis valores da escala são os únicos aceitos, todos ímpares (pesos 1, 3 e 5)", () => {
    expect([...answerValues]).toEqual([-5, -3, -1, 1, 3, 5]);
    expect(answerValues.every((value) => Math.abs(value) % 2 === 1)).toBe(true);
  });

  it("é pura: não altera as respostas nem o config", () => {
    const answers = answersFor(base);
    const frozen = structuredClone(answers);
    scoreQuestionnaire(config, answers);
    expect(answers).toEqual(frozen);
    expect(scoreQuestionnaire(config, answers)).toEqual(scoreQuestionnaire(config, answers));
  });
});
