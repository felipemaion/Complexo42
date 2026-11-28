import { describe, expect, it } from "vitest";
import { maxSkillsPerPerson, normalizeSkillText, parseSkillName } from "./skill-name";

describe("parseSkillName (nome de habilidade sugerido, texto livre da pessoa; #15)", () => {
  it("tira espaço das pontas e junta os do meio", () => {
    expect(parseSkillName("  Jardinagem   urbana  ")).toBe("Jardinagem urbana");
  });

  it("recusa menos de 2 e mais de 80 caracteres", () => {
    expect(parseSkillName("a")).toBeNull();
    expect(parseSkillName("ab")).toBe("ab");
    expect(parseSkillName("x".repeat(80))).toBe("x".repeat(80));
    expect(parseSkillName("x".repeat(81))).toBeNull();
  });

  it("recusa caractere de controle, quebra de linha e invisível (largura zero, marca de direção)", () => {
    for (const bad of ["Ma\u0007ria", "Ma\nria", "Ma​ria", "Ma‮ria", "Ma﻿ria", "Ma­ria"]) expect(parseSkillName(bad), bad).toBeNull();
  });

  it("recusa o que não é texto", () => {
    expect(parseSkillName(undefined)).toBeNull();
    expect(parseSkillName(42)).toBeNull();
    expect(parseSkillName("   ")).toBeNull();
  });
});

describe("normalizeSkillText (filtro do catálogo na tela)", () => {
  it("ignora caixa e acento", () => {
    expect(normalizeSkillText("  ORATÓRIA ")).toBe("oratoria");
    expect(normalizeSkillText("Cerâmica")).toBe("ceramica");
  });
});

describe("limite", () => {
  it("são 10 habilidades por pessoa (decisão de 28/11)", () => {
    expect(maxSkillsPerPerson).toBe(10);
  });
});
