import { describe, expect, it } from "vitest";
import { instance } from "@config/instance";
import example from "@config/questionnaire.example.json";
import { parseQuestionnaire, QuestionnaireConfigError, questionnaireSchema } from "./schema";

const houseIds = instance.houses.map((h) => h.id);

type Raw = Omit<typeof example, "axes"> & {
  axes: Record<
    "house1" | "house2" | "totem1" | "totem2",
    { label: string; poleLabels: { a: string; b: string }; itemIds: string[]; letters?: { a: string; b: string } }
  >;
};
const clone = (): Raw => structuredClone(example) as Raw;

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
  it("é válido e aponta para as quatro casas de config/instance.ts", () => {
    const config = parseQuestionnaire(example, houseIds);
    expect(config.items.length).toBeGreaterThanOrEqual(8);
    expect(config.items.length).toBeLessThanOrEqual(12);
    expect(Object.values(config.houseByPoles).sort()).toEqual([...houseIds].sort());
  });

  it("coloca cada item em exatamente um eixo", () => {
    const config = parseQuestionnaire(example, houseIds);
    const placed = Object.values(config.axes).flatMap((axis) => axis.itemIds);
    expect([...placed].sort()).toEqual(config.items.map((i) => i.id).sort());
  });
});

describe("questionnaireSchema", () => {
  it("rejeita item em dois eixos", () => {
    const raw = clone();
    raw.axes.house2.itemIds.push(raw.axes.house1.itemIds[0]!);
    expect(fieldsOf(raw)).toEqual([`axes.house2.itemIds.${raw.axes.house2.itemIds.length - 1}`]);
  });

  it("rejeita item repetido no mesmo eixo", () => {
    const raw = clone();
    raw.axes.house1.itemIds.push(raw.axes.house1.itemIds[0]!);
    expect(fieldsOf(raw)).toEqual([`axes.house1.itemIds.${raw.axes.house1.itemIds.length - 1}`]);
  });

  it("rejeita item que nenhum eixo lista", () => {
    const raw = clone();
    raw.axes.house1.itemIds = raw.axes.house1.itemIds.slice(2);
    expect(fieldsOf(raw)).toEqual(["items.0.id", "items.1.id"]);
  });

  it("rejeita eixo que cita item inexistente", () => {
    const raw = clone();
    raw.axes.totem1.itemIds[0] = "zz";
    expect(fieldsOf(raw)).toContain("axes.totem1.itemIds.0");
  });

  it("rejeita eixo com número par de itens (a soma poderia empatar), em qualquer eixo", () => {
    const raw = clone();
    const moved = raw.axes.house1.itemIds.pop()!;
    raw.axes.house2.itemIds.push(moved);
    expect(fieldsOf(raw)).toEqual(["axes.house1.itemIds", "axes.house2.itemIds"]);
    const totem = clone();
    const dropped = totem.axes.totem2.itemIds.pop()!;
    totem.items = totem.items.filter((item) => item.id !== dropped);
    expect(fieldsOf(totem)).toEqual(["axes.totem2.itemIds"]);
  });

  it("não aceita mais desempate: tieBreakItems é campo desconhecido", () => {
    const raw = clone() as unknown as { axes: Record<string, Record<string, unknown>> };
    raw.axes.house1!.tieBreakItems = [];
    expect(fieldsOf(raw)).toEqual(["axes.house1"]);
  });

  it("rejeita id de item repetido", () => {
    const raw = clone();
    raw.items[2]!.id = raw.items[0]!.id;
    expect(fieldsOf(raw)).toContain("items.2.id");
  });

  it("rejeita letras iguais nos dois polos do totem e letra que não é maiúscula", () => {
    const same = clone();
    same.axes.totem1.letters!.b = same.axes.totem1.letters!.a;
    expect(fieldsOf(same)).toEqual(["axes.totem1.letters"]);
    const lower = clone();
    lower.axes.totem2.letters!.a = "v";
    expect(fieldsOf(lower)).toEqual(["axes.totem2.letters.a"]);
  });

  it("rejeita casas repetidas no mapa e casa fora da instância", () => {
    const repeated = clone();
    repeated.houseByPoles.bb = repeated.houseByPoles.aa;
    expect(fieldsOf(repeated)).toEqual(["houseByPoles"]);
    expect(fieldsOf(clone(), houseIds.slice(1))).toEqual(["houseByPoles.aa"]);
  });

  it("exige os quatro eixos, o mapa, a versão, o termo e só campos conhecidos", () => {
    const noAxis = clone() as unknown as { axes: Record<string, unknown> };
    delete noAxis.axes.totem2;
    expect(fieldsOf(noAxis)).toEqual(["axes.totem2"]);
    const noMap = clone() as unknown as Record<string, unknown>;
    delete noMap.houseByPoles;
    expect(fieldsOf(noMap)).toEqual(["houseByPoles"]);
    const noVersion = clone() as unknown as Record<string, unknown>;
    delete noVersion.consentTermVersion;
    expect(fieldsOf(noVersion)).toEqual(["consentTermVersion"]);
    expect(questionnaireSchema.safeParse({ ...clone(), extra: 1 }).success).toBe(false);
    const oldFormat = clone();
    (oldFormat.items[0] as unknown as { axis: string }).axis = "SN";
    expect(fieldsOf(oldFormat)).toEqual(["items.0"]);
  });

  it("cada eixo precisa de nome e do nome dos dois polos", () => {
    const noLabel = clone() as unknown as { axes: Record<string, Record<string, unknown>> };
    delete noLabel.axes.house1!.label;
    expect(fieldsOf(noLabel)).toEqual(["axes.house1.label"]);
    const noPole = clone() as unknown as { axes: Record<string, { poleLabels: Record<string, unknown> }> };
    delete noPole.axes.totem2!.poleLabels.b;
    expect(fieldsOf(noPole)).toEqual(["axes.totem2.poleLabels.b"]);
    const blank = clone();
    blank.axes.house2.poleLabels.a = "   ";
    expect(fieldsOf(blank)).toEqual(["axes.house2.poleLabels.a"]);
  });

  it("rejeita alternativa sem texto e texto só com espaços", () => {
    const raw = clone();
    raw.items[0]!.a.text = "   ";
    expect(fieldsOf(raw)).toEqual(["items.0.a.text"]);
  });

  it("a mensagem de erro cita só os campos, nunca o texto das perguntas", () => {
    const raw = clone();
    raw.items[0]!.text = "TEXTO-SECRETO";
    raw.axes.totem1.letters!.b = raw.axes.totem1.letters!.a;
    try {
      parseQuestionnaire(raw, houseIds);
      expect.unreachable();
    } catch (err) {
      expect((err as Error).message).not.toContain("TEXTO-SECRETO");
    }
  });

  it("devolve o config congelado", () => {
    expect(Object.isFrozen(parseQuestionnaire(example, houseIds))).toBe(true);
  });
});
