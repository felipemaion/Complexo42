import { describe, expect, it } from "vitest";
import {
  filterMunicipalities,
  hasDistrictChoice,
  normalizeForSearch,
  patchOnMunicipalityChange,
  patchOnStateChange,
} from "./localities";

const options = [
  { code: 3509502, name: "Campinas" },
  { code: 3550308, name: "São Paulo" },
  { code: 3548708, name: "São Bernardo do Campo" },
  { code: 3304557, name: "Rio de Janeiro" },
];

describe("normalizeForSearch", () => {
  it("ignora acento, caixa e espaços nas pontas", () => {
    expect(normalizeForSearch("  São JOSÉ ")).toBe("sao jose");
  });
});

describe("filterMunicipalities", () => {
  it("sem texto, devolve a lista inteira", () => {
    expect(filterMunicipalities(options, "  ", null)).toHaveLength(4);
  });

  it("acha pelo meio do nome, sem acento nem caixa", () => {
    expect(filterMunicipalities(options, "sao", null).map((o) => o.name)).toEqual(["São Paulo", "São Bernardo do Campo"]);
    expect(filterMunicipalities(options, "CAMPO", null).map((o) => o.name)).toEqual(["São Bernardo do Campo"]);
  });

  it("busca sem resultado dá lista vazia", () => {
    expect(filterMunicipalities(options, "xyz", null)).toEqual([]);
  });

  it("a cidade já escolhida continua na lista mesmo que a busca não a ache", () => {
    expect(filterMunicipalities(options, "campinas", 3304557).map((o) => o.name)).toEqual(["Campinas", "Rio de Janeiro"]);
  });
});

describe("hasDistrictChoice", () => {
  it("só há escolha com mais de um distrito", () => {
    expect(hasDistrictChoice([])).toBe(false);
    expect(hasDistrictChoice([{ code: 355030801, name: "Sede" }])).toBe(false);
    expect(
      hasDistrictChoice([
        { code: 355030801, name: "Água Rasa" },
        { code: 355030802, name: "Alto de Pinheiros" },
      ]),
    ).toBe(true);
  });
});

describe("o que trocar de lugar zera", () => {
  it("estado novo: cidade, distrito e bairro voltam a vazio", () => {
    expect(patchOnStateChange("MG")).toEqual({ stateCode: "MG", municipalityCode: "", district: "", neighborhood: "" });
  });

  it("cidade nova: distrito e bairro voltam a vazio, o estado não muda", () => {
    expect(patchOnMunicipalityChange("3106200")).toEqual({ municipalityCode: "3106200", district: "", neighborhood: "" });
  });
});
