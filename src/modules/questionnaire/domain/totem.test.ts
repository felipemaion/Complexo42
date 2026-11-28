import { describe, expect, it } from "vitest";
import { instance } from "@config/instance";
import example from "@config/questionnaire.example.json";
import { parseQuestionnaire } from "./schema";
import { totemCodes, totemLabel, totemName } from "./totem";

const config = parseQuestionnaire(example, instance.houses.map((house) => house.id));

describe("totemCodes", () => {
  it("são as quatro combinações das letras dos polos do eixo 3 e do eixo 4, na ordem aa, ab, ba, bb", () => {
    expect(totemCodes(config)).toEqual(["XV", "XW", "YV", "YW"]);
  });
});

describe("totemLabel", () => {
  it("mostra 'Nome (CÓDIGO)' com o nome do mapa totemLabels da config", () => {
    const [first] = totemCodes(config) as [string];
    expect(totemLabel(config, first)).toBe(`${config.totemLabels[first]!.name} (${first})`);
  });

  it("código sem nome no mapa (ou lixo): só o código, nunca quebra", () => {
    expect(totemLabel(config, "ZZ")).toBe("ZZ");
    expect(totemLabel(config, "")).toBe("");
  });

  it("totem nulo (resultado antigo ou ilegível): vazio", () => {
    expect(totemLabel(config, null)).toBe("");
  });
});

describe("totemLabels no esquema", () => {
  const clone = () => structuredClone(example) as unknown as { totemLabels: Record<string, { name: string; description: string }> };
  const fields = (raw: unknown): string[] => {
    try {
      parseQuestionnaire(raw, instance.houses.map((house) => house.id));
    } catch (err) {
      return (err as { fields?: string[] }).fields ?? ["?"];
    }
    return [];
  };

  it("o exemplo traz os quatro totens com nome e descrição curta", () => {
    for (const code of totemCodes(config)) {
      expect(config.totemLabels[code]?.name.length).toBeGreaterThan(0);
      expect(config.totemLabels[code]?.description.length).toBeGreaterThan(0);
    }
  });

  it("exige exatamente os quatro códigos: falta um", () => {
    const raw = clone();
    delete raw.totemLabels.XV;
    expect(fields(raw)).toEqual(["totemLabels"]);
  });

  it("exige exatamente os quatro códigos: sobra um", () => {
    const raw = clone();
    raw.totemLabels.ZZ = { name: "Sobra", description: "x" };
    expect(fields(raw)).toEqual(["totemLabels"]);
  });

  it("nome e descrição não podem ser vazios", () => {
    const raw = clone();
    raw.totemLabels.XW!.name = "  ";
    expect(fields(raw)).toEqual(["totemLabels.XW.name"]);
    const raw2 = clone();
    raw2.totemLabels.YV!.description = "";
    expect(fields(raw2)).toEqual(["totemLabels.YV.description"]);
  });

  it("o mapa é obrigatório", () => {
    const raw = clone() as unknown as Record<string, unknown>;
    delete raw.totemLabels;
    expect(fields(raw)).toEqual(["totemLabels"]);
  });
});

describe("totemName", () => {
  it("só o nome (alt da medalha); código sem nome vira o código; sem totem, vazio", () => {
    expect(totemName(config, "XV")).toBe("Totem Um");
    expect(totemName(config, "ZZ")).toBe("ZZ");
    expect(totemName(config, null)).toBe("");
    expect(totemName(config, "")).toBe("");
  });
});
