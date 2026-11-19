import { describe, expect, it } from "vitest";
import { consentTerm } from "@config/consent";

describe("config/consent.ts", () => {
  it("é válida, na versão v1 do rascunho, e sem trecho pendente do jurídico na tela", () => {
    expect(consentTerm.version).toBe("v1");
    const everyText = JSON.stringify(consentTerm);
    expect(everyText).not.toMatch(/\[(jur[ií]dico|decidir)/i);
    expect(everyText).not.toMatch(/\[[A-ZÀ-Ú ]{4,}\]/);
  });
});
