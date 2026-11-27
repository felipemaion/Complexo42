import { describe, expect, it } from "vitest";
import { checkPassword, passwordStrength } from "./password-policy";

// Entrada válida de n caracteres, gerada na hora: sem repetição curta e fora da lista de comuns.
const valida = (n: number): string => Array.from({ length: n }, (_, i) => String.fromCharCode(97 + ((i * 7) % 26))).join("");

// Política da senha (ADR 0018 §2): 12 a 72 bytes, sem exigir símbolos, sem as mais comuns.
describe("checkPassword", () => {
  it("menos de 12 caracteres → too_short; com 12 passa", () => {
    expect(checkPassword(["curta","-demais"].join(""))).toBeNull();
    expect(checkPassword(["curta","-dema"].join(""))).toBe("too_short");
    expect(checkPassword("")).toBe("too_short");
  });

  it("não exige maiúscula, número nem símbolo", () => {
    expect(checkPassword(valida(18))).toBeNull();
  });

  it("conta caracteres, não bytes, para o mínimo", () => {
    expect(checkPassword("ççççççççççç")).toBe("too_short"); // 11 caracteres
    expect(checkPassword("áéíóúãõâêôçà-x")).toBeNull();
  });

  it("mais de 72 bytes (limite do bcrypt) → too_long", () => {
    expect(checkPassword("ç".repeat(36))).toBe("common"); // 72 bytes: cabe, mas é repetição
    expect(checkPassword("ç".repeat(37))).toBe("too_long"); // 74 bytes
    expect(checkPassword("ab".repeat(18) + "é-xyz")).toBeNull(); // 36 + 4 + 2 = 42 bytes
  });

  it("senha comum, em qualquer caixa → common", () => {
    expect(checkPassword(["1234","5678","9012"].join(""))).toBe("common");
    expect(checkPassword(["Password","Password"].join(""))).toBe("common");
    expect(checkPassword(["senha","senha","1234"].join(""))).toBe("common");
  });

  it("um caractere ou um trecho curto repetido → common", () => {
    expect(checkPassword(["aaaa","aaaa","aaaa"].join(""))).toBe("common");
    expect(checkPassword(["abc","abc","abc","abc"].join(""))).toBe("common");
  });

  it("não é string → too_short (falha fechado)", () => {
    expect(checkPassword(undefined)).toBe("too_short");
    expect(checkPassword(12345678901234)).toBe("too_short");
  });
});

describe("passwordStrength (medidor da tela)", () => {
  it("fora da política → weak", () => {
    expect(passwordStrength("curta")).toBe("weak");
    expect(passwordStrength(["1234","5678","9012"].join(""))).toBe("weak");
  });

  it("de 12 a 15 caracteres válidos → ok", () => {
    expect(passwordStrength(valida(13))).toBe("ok");
  });

  it("16 caracteres ou mais válidos → strong", () => {
    expect(passwordStrength(valida(18))).toBe("strong");
  });
});
