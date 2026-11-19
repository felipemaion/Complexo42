import { describe, expect, it } from "vitest";
import { maskEmail } from "./mask";

describe("maskEmail (#9)", () => {
  it.each([
    ["fulano@gmail.com", "fu***@g***.com"],
    ["ana@exemplo.org", "a***@e***.org"],
    ["a@b.co", "a***@b***.co"],
    ["pessoa.teste@mail.exemplo.com.br", "pe***@m***.br"],
    ["joão@domínio.com", "jo***@d***.com"],
  ])("%s → %s", (email, masked) => {
    expect(maskEmail(email)).toBe(masked);
  });

  it("nunca devolve o local nem o domínio inteiros", () => {
    const masked = maskEmail("fulano.de.tal@empresa.com");
    expect(masked).not.toContain("fulano");
    expect(masked).not.toContain("empresa");
  });

  it("entrada estranha vira só asteriscos", () => {
    expect(maskEmail("sem-arroba")).toBe("***");
    expect(maskEmail("@x.com")).toBe("***");
    expect(maskEmail("x@")).toBe("***");
  });
});
