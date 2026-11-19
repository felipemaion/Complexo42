import { describe, expect, it } from "vitest";
import { brazilianWhatsappToE164, formatBrazilianWhatsapp } from "./whatsapp";

describe("brazilianWhatsappToE164", () => {
  it("aceita o celular do jeito que as pessoas escrevem e devolve E.164", () => {
    for (const typed of [
      "(11) 91234-5678",
      "11912345678",
      "11 91234 5678",
      "+55 11 91234-5678",
      "+55 (11) 91234-5678",
      "5511912345678",
      "011 91234-5678",
      "011.91234.5678",
      "  (11) 91234-5678  ",
    ]) {
      expect(brazilianWhatsappToE164(typed), typed).toBe("+5511912345678");
    }
    expect(brazilianWhatsappToE164("(92) 98765-4321")).toBe("+5592987654321");
  });

  it("recusa número que não é celular brasileiro válido", () => {
    for (const typed of [
      "",
      "1234",
      "(11) 1234-5678", // fixo (8 dígitos)
      "(11) 81234-5678", // não começa com 9
      "(10) 91234-5678", // DDD inexistente
      "(20) 91234-5678", // DDD inexistente
      "(11) 91234-56789", // dígito a mais
      "+1 415 555 0100", // outro país
      "+54 11 91234-5678", // outro país com 13 dígitos
      "11 9abc4-5678", // letras
      "(11) 91234-5678 ramal 2", // texto junto
      "1".repeat(30), // longo demais
    ]) {
      expect(brazilianWhatsappToE164(typed), typed).toBeNull();
    }
    expect(brazilianWhatsappToE164(11912345678)).toBeNull();
    expect(brazilianWhatsappToE164(null)).toBeNull();
  });
});

describe("formatBrazilianWhatsapp (máscara)", () => {
  it("formata enquanto a pessoa digita, sem inventar dígitos", () => {
    expect(formatBrazilianWhatsapp("")).toBe("");
    expect(formatBrazilianWhatsapp("1")).toBe("(1");
    expect(formatBrazilianWhatsapp("11")).toBe("(11");
    expect(formatBrazilianWhatsapp("119")).toBe("(11) 9");
    expect(formatBrazilianWhatsapp("1191234")).toBe("(11) 91234");
    expect(formatBrazilianWhatsapp("11912345")).toBe("(11) 91234-5");
    expect(formatBrazilianWhatsapp("11912345678")).toBe("(11) 91234-5678");
  });

  it("ignora o que não é dígito e corta no 11º dígito", () => {
    expect(formatBrazilianWhatsapp("(11) 91234-5678999")).toBe("(11) 91234-5678");
    expect(formatBrazilianWhatsapp("ab11c9")).toBe("(11) 9");
  });

  it("mostra o número salvo (E.164) e o colado com +55 ou 0 no formato nacional", () => {
    expect(formatBrazilianWhatsapp("+5511912345678")).toBe("(11) 91234-5678");
    expect(formatBrazilianWhatsapp("+55 (11) 91234-5678")).toBe("(11) 91234-5678");
    expect(formatBrazilianWhatsapp("5511912345678")).toBe("(11) 91234-5678");
    expect(formatBrazilianWhatsapp("011912345678")).toBe("(11) 91234-5678");
  });

  it("o que a máscara mostra continua válido para o servidor", () => {
    expect(brazilianWhatsappToE164(formatBrazilianWhatsapp("+5511912345678"))).toBe("+5511912345678");
  });
});
