import { describe, expect, it } from "vitest";
import { instance } from "@config/instance";
import example from "@config/questionnaire.example.json";
import { parseQuestionnaire, QuestionnaireConfigError, questionnaireSchema } from "./schema";

const houseIds = instance.houses.map((h) => h.id);

type Raw = typeof example;
const clone = (): Raw => structuredClone(example);

function fieldsOf(raw: unknown, houses: readonly string[] = houseIds): string[] {
  try {
    parseQuestionnaire(raw, houses);
  } catch (err) {
    if (err instanceof QuestionnaireConfigError) return err.fields;
    throw err;
  }
  return [];
}

describe("questionário de exemplo (config/questionnaire.example.json)", () => {
  it("é válido e aponta para casas que existem em config/instance.ts", () => {
    const config = parseQuestionnaire(example, houseIds);
    expect(config.items.length).toBeGreaterThanOrEqual(8);
    expect(config.items.length).toBeLessThanOrEqual(12);
    for (const houseId of Object.values(config.houseByTemperament)) expect(houseIds).toContain(houseId);
  });

  it("cobre os quatro eixos", () => {
    const axes = new Set(example.items.map((i) => i.axis));
    expect([...axes].sort()).toEqual(["EI", "JP", "SN", "TF"]);
  });
});

describe("questionnaireSchema", () => {
  it("rejeita item com eixo desconhecido", () => {
    const raw = clone();
    (raw.items[0] as { axis: string }).axis = "XY";
    expect(questionnaireSchema.safeParse(raw).success).toBe(false);
    expect(fieldsOf(raw)).toContain("items.0.axis");
  });

  it("rejeita polo que não pertence ao eixo do item", () => {
    const raw = clone();
    raw.items[1]!.a.pole = "T"; // item de S/N
    expect(fieldsOf(raw)).toEqual(["items.1.a.pole"]);
  });

  it("rejeita alternativas que marcam o mesmo polo", () => {
    const raw = clone();
    raw.items[1]!.b.pole = raw.items[1]!.a.pole;
    expect(fieldsOf(raw)).toEqual(["items.1.b.pole"]);
  });

  it("rejeita id de item repetido", () => {
    const raw = clone();
    raw.items[2]!.id = raw.items[0]!.id;
    expect(fieldsOf(raw)).toEqual(["items.2.id"]);
  });

  it("exige ao menos um item em S/N, T/F e J/P; E/I é opcional (pergunta 77)", () => {
    const noJp = clone();
    noJp.items = noJp.items.filter((i) => i.axis !== "JP");
    expect(fieldsOf(noJp)).toEqual(["items"]);
    const noEi = clone();
    noEi.items = noEi.items.filter((i) => i.axis !== "EI");
    expect(fieldsOf(noEi)).toEqual([]);
  });

  it("exige o mapa dos quatro temperamentos, a versão e o texto do termo e campos conhecidos", () => {
    const raw = clone() as Partial<Raw> & { extra?: number };
    delete (raw.houseByTemperament as Partial<Raw["houseByTemperament"]>).SP;
    delete raw.consentTermVersion;
    delete raw.consentTerm;
    raw.extra = 1;
    expect(fieldsOf(raw).sort()).toEqual(["(raiz)", "consentTerm", "consentTermVersion", "houseByTemperament.SP"]);
  });

  it("aplica a regra de desempate padrão quando ela não vem no arquivo", () => {
    const raw: Partial<Raw> = clone();
    delete raw.tieBreak;
    expect(parseQuestionnaire(raw, houseIds).tieBreak).toEqual({ EI: "I", SN: "N", TF: "F", JP: "P" });
  });

  it("rejeita desempate com polo de outro eixo", () => {
    const raw = clone();
    raw.tieBreak.SN = "T";
    expect(fieldsOf(raw)).toEqual(["tieBreak.SN"]);
  });
});

describe("referência às casas da instância", () => {
  it("rejeita casa que não existe em config/instance.ts, citando o temperamento", () => {
    const raw = clone();
    raw.houseByTemperament.NT = "casa-inexistente";
    expect(fieldsOf(raw)).toEqual(["houseByTemperament.NT"]);
  });

  it("a mensagem cita só os campos, nunca o texto das perguntas", () => {
    const raw = clone();
    raw.items[0]!.a.pole = "X";
    const error = (() => {
      try {
        parseQuestionnaire(raw, houseIds);
      } catch (err) {
        return err as Error;
      }
    })();
    expect(error?.message).toContain("items.0.a.pole");
    expect(error?.message).not.toContain(raw.items[0]!.text);
  });

  it("devolve o config congelado", () => {
    expect(Object.isFrozen(parseQuestionnaire(example, houseIds))).toBe(true);
  });
});
