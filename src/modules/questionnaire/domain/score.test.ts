import { describe, expect, it } from "vitest";
import { parseQuestionnaire, type QuestionnaireConfig } from "./schema";
import { QuestionnaireAnswerError, scoreQuestionnaire, type Answer, type Answers } from "./score";

// Questionário de teste: dois itens por eixo (permite empate). No segundo item de cada eixo a
// alternativa `a` marca o polo oposto, para provar que a contagem segue o config e não a letra.
const raw = {
  version: "teste",
  consentTermVersion: "termo-teste",
  consentTerm: "termo de teste",
  houseByTemperament: { NF: "casa-nf", SJ: "casa-sj", NT: "casa-nt", SP: "casa-sp" },
  items: [
    { id: "ei1", text: "x", axis: "EI", a: { text: "x", pole: "E" }, b: { text: "x", pole: "I" } },
    { id: "ei2", text: "x", axis: "EI", a: { text: "x", pole: "I" }, b: { text: "x", pole: "E" } },
    { id: "sn1", text: "x", axis: "SN", a: { text: "x", pole: "S" }, b: { text: "x", pole: "N" } },
    { id: "sn2", text: "x", axis: "SN", a: { text: "x", pole: "N" }, b: { text: "x", pole: "S" } },
    { id: "tf1", text: "x", axis: "TF", a: { text: "x", pole: "T" }, b: { text: "x", pole: "F" } },
    { id: "tf2", text: "x", axis: "TF", a: { text: "x", pole: "F" }, b: { text: "x", pole: "T" } },
    { id: "jp1", text: "x", axis: "JP", a: { text: "x", pole: "J" }, b: { text: "x", pole: "P" } },
    { id: "jp2", text: "x", axis: "JP", a: { text: "x", pole: "P" }, b: { text: "x", pole: "J" } },
  ],
};
const houses = ["casa-nf", "casa-sj", "casa-nt", "casa-sp"];
const config = parseQuestionnaire(raw, houses);

/** Respostas que marcam os polos pedidos nos dois itens de cada eixo. */
function pure(pick: { EI: "E" | "I"; SN: "S" | "N"; TF: "T" | "F"; JP: "J" | "P" }): Answers {
  const answers: Record<string, Answer> = {};
  for (const item of config.items) answers[item.id] = item.a.pole === pick[item.axis] ? "a" : "b";
  return answers;
}

const all = (answer: Answer): Answers => Object.fromEntries(config.items.map((i) => [i.id, answer]));

describe("scoreQuestionnaire", () => {
  it.each([
    [{ EI: "E", SN: "N", TF: "F", JP: "J" }, "NF", "casa-nf"],
    [{ EI: "I", SN: "S", TF: "T", JP: "J" }, "SJ", "casa-sj"],
    [{ EI: "E", SN: "N", TF: "T", JP: "P" }, "NT", "casa-nt"],
    [{ EI: "I", SN: "S", TF: "F", JP: "P" }, "SP", "casa-sp"],
  ] as const)("respostas puras %o levam a %s", (pick, temperament, houseId) => {
    expect(scoreQuestionnaire(config, pure(pick))).toEqual({ temperament, houseId });
  });

  it("E/I não muda a casa", () => {
    const base = { SN: "S", TF: "T", JP: "J" } as const;
    expect(scoreQuestionnaire(config, pure({ ...base, EI: "E" }))).toEqual(scoreQuestionnaire(config, pure({ ...base, EI: "I" })));
  });

  it("T/F não importa com S, e J/P não importa com N (derivação de Keirsey)", () => {
    expect(scoreQuestionnaire(config, pure({ EI: "E", SN: "S", TF: "F", JP: "J" })).temperament).toBe("SJ");
    expect(scoreQuestionnaire(config, pure({ EI: "E", SN: "N", TF: "T", JP: "J" })).temperament).toBe("NT");
  });

  describe("empate", () => {
    // Um ponto para cada polo no eixo testado (1 × 1): `a` nos dois itens, que têm polos invertidos.
    const tie = (axis: "SN" | "TF" | "JP", base: Answers): Answers => ({ ...base, [`${axis.toLowerCase()}1`]: "a", [`${axis.toLowerCase()}2`]: "a" });

    it("regra padrão (I, N, F, P) quando o config não define outra", () => {
      expect(config.tieBreak).toEqual({ EI: "I", SN: "N", TF: "F", JP: "P" });
    });

    it("no eixo S/N vence N pela regra padrão", () => {
      const answers = tie("SN", pure({ EI: "E", SN: "S", TF: "T", JP: "J" }));
      expect(scoreQuestionnaire(config, answers).temperament).toBe("NT");
    });

    it("no eixo T/F vence F pela regra padrão", () => {
      const answers = tie("TF", pure({ EI: "E", SN: "N", TF: "T", JP: "J" }));
      expect(scoreQuestionnaire(config, answers).temperament).toBe("NF");
    });

    it("no eixo J/P vence P pela regra padrão", () => {
      const answers = tie("JP", pure({ EI: "E", SN: "S", TF: "T", JP: "J" }));
      expect(scoreQuestionnaire(config, answers).temperament).toBe("SP");
    });

    it("no eixo E/I o empate não altera a casa", () => {
      const base = pure({ EI: "E", SN: "S", TF: "T", JP: "J" });
      expect(scoreQuestionnaire(config, { ...base, ei1: "a", ei2: "a" })).toEqual(scoreQuestionnaire(config, base));
    });

    it("segue a regra do config quando ela muda", () => {
      const custom = parseQuestionnaire({ ...raw, tieBreak: { EI: "E", SN: "S", TF: "T", JP: "J" } }, houses);
      expect(scoreQuestionnaire(custom, tie("SN", pure({ EI: "E", SN: "N", TF: "F", JP: "P" }))).temperament).toBe("SP");
      expect(scoreQuestionnaire(custom, tie("JP", pure({ EI: "E", SN: "S", TF: "F", JP: "P" }))).temperament).toBe("SJ");
      expect(scoreQuestionnaire(custom, tie("TF", pure({ EI: "E", SN: "N", TF: "F", JP: "P" }))).temperament).toBe("NT");
    });
  });

  describe('"as duas"', () => {
    it("em todos os itens empata todos os eixos e cai na regra de desempate (NF)", () => {
      expect(scoreQuestionnaire(config, all("both"))).toEqual({ temperament: "NF", houseId: "casa-nf" });
    });

    it("conta meio ponto para cada polo: 1 + ½ vence ½", () => {
      // sn1 = S (1 ponto), sn2 = as duas (½ S, ½ N) → S 1,5 × N 0,5.
      const answers = { ...pure({ EI: "E", SN: "N", TF: "T", JP: "J" }), sn1: "a", sn2: "both" } as const;
      expect(scoreQuestionnaire(config, answers).temperament).toBe("SJ");
    });
  });

  describe("respostas inválidas", () => {
    it("resposta faltando gera erro com o id do item", () => {
      const answers: Record<string, Answer> = { ...pure({ EI: "E", SN: "N", TF: "T", JP: "J" }) };
      delete answers.tf2;
      expect(() => scoreQuestionnaire(config, answers)).toThrow(QuestionnaireAnswerError);
      expect(() => scoreQuestionnaire(config, answers)).toThrow("item sem resposta): tf2");
      try {
        scoreQuestionnaire(config, answers);
      } catch (err) {
        expect(err).toMatchObject({ code: "missing_answer", itemIds: ["tf2"] });
      }
    });

    it("nenhuma resposta lista todos os itens", () => {
      expect(() => scoreQuestionnaire(config, {})).toThrow(config.items.map((i) => i.id).join(", "));
    });

    it("resposta para item inexistente é rejeitada", () => {
      expect(() => scoreQuestionnaire(config, { ...all("a"), extra: "a" })).toThrow(/item inexistente\): extra/);
    });

    it("valor fora de a, b ou both é rejeitado", () => {
      const answers = { ...all("a"), jp1: "c" } as unknown as Answers;
      expect(() => scoreQuestionnaire(config, answers)).toThrow(/a, b ou both\): jp1/);
    });
  });

  it("o retorno contém só temperament e houseId (as respostas não saem da função)", () => {
    const result = scoreQuestionnaire(config, pure({ EI: "I", SN: "S", TF: "F", JP: "P" }));
    expect(Object.keys(result).sort()).toEqual(["houseId", "temperament"]);
  });

  it("não altera as respostas nem o config recebidos", () => {
    const answers = Object.freeze(pure({ EI: "I", SN: "N", TF: "T", JP: "P" }));
    const before = JSON.stringify(config);
    scoreQuestionnaire(config as QuestionnaireConfig, answers);
    expect(JSON.stringify(config)).toBe(before);
  });
});
