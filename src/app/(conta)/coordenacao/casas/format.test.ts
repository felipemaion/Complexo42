import { describe, expect, it } from "vitest";
import { errorText } from "./format";

const errors = { forbidden: "Sem permissão.", failed: "Falhou." };

describe("errorText (o código vem da URL: só chave própria da config vale)", () => {
  it("devolve o texto do código conhecido", () => {
    expect(errorText(errors, "forbidden")).toBe("Sem permissão.");
  });

  it("código desconhecido, vazio ou ausente: nada", () => {
    expect(errorText(errors, "outro")).toBeNull();
    expect(errorText(errors, "")).toBeNull();
    expect(errorText(errors, undefined)).toBeNull();
  });

  it.each(["__proto__", "constructor", "toString", "hasOwnProperty", "valueOf"])("%s (herdado do Object) NÃO vale", (code) => {
    expect(errorText(errors, code)).toBeNull();
  });
});
