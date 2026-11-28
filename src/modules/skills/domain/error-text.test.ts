import { describe, expect, it } from "vitest";
import { skillErrorText } from "./error-text";

const errors = { invalid: "Confira.", failed: "Falhou." };

describe("skillErrorText", () => {
  it("sem erro na URL, sem texto", () => {
    expect(skillErrorText(errors, undefined)).toBeNull();
    expect(skillErrorText(errors, "")).toBeNull();
  });

  it("chave do mapa devolve o seu texto", () => {
    expect(skillErrorText(errors, "invalid")).toBe("Confira.");
  });

  it("chave desconhecida ou herdada do Object cai em failed", () => {
    for (const key of ["nao-existe", "constructor", "toString", "__proto__", "hasOwnProperty"]) {
      expect(skillErrorText(errors, key)).toBe("Falhou.");
    }
  });
});
