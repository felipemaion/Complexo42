import { describe, expect, it } from "vitest";
import { AllowlistImportError, allowlistLimits, normalizeAllowlistEmail, parseAllowlistCsv } from "./allowlist-csv";

function errorOf(fn: () => unknown): AllowlistImportError {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(AllowlistImportError);
    return error as AllowlistImportError;
  }
  throw new Error("esperava AllowlistImportError");
}

describe("parseAllowlistCsv", () => {
  it("lê uma coluna de e-mails com cabeçalho, normaliza e tira repetidos", () => {
    const csv = "email\nMaria@Exemplo.org\n  joao@exemplo.org  \nmaria@exemplo.org\n";
    expect(parseAllowlistCsv(csv)).toEqual({
      emails: ["maria@exemplo.org", "joao@exemplo.org"],
      invalidLines: [],
    });
  });

  it("acha o e-mail em qualquer coluna e ignora as outras (nome, telefone)", () => {
    const csv = '﻿Nome;E-mail;Telefone\r\n"Silva, Ana";"ANA@x.org";11999998888\r\nBeto\tbeto@x.org\t\r\n';
    expect(parseAllowlistCsv(csv).emails).toEqual(["ana@x.org", "beto@x.org"]);
  });

  it("aceita arquivo sem cabeçalho", () => {
    expect(parseAllowlistCsv("a@x.org\nb@x.org").emails).toEqual(["a@x.org", "b@x.org"]);
  });

  it("aponta só o número das linhas inválidas, nunca o conteúdo", () => {
    const csv = "email\na@x.org\nsem e-mail aqui\nfulano@\n@x.org\nb @x.org\n\nc@x.org";
    const result = parseAllowlistCsv(csv);
    expect(result.emails).toEqual(["a@x.org", "c@x.org"]);
    expect(result.invalidLines).toEqual([3, 4, 5, 6]);
    expect(JSON.stringify(result.invalidLines)).not.toMatch(/fulano|@/);
  });

  it("recusa arquivo sem nenhum e-mail válido, sem citar o conteúdo", () => {
    const error = errorOf(() => parseAllowlistCsv("email\nfulano@\n"));
    expect(error.code).toBe("empty");
    expect(error.message).not.toMatch(/fulano/);
    expect(errorOf(() => parseAllowlistCsv("")).code).toBe("empty");
  });

  it("recusa arquivo acima do tamanho e da quantidade máximos", () => {
    expect(errorOf(() => parseAllowlistCsv("x".repeat(allowlistLimits.maxBytes + 1))).code).toBe("too_large");
    const many = Array.from({ length: allowlistLimits.maxEmails + 1 }, (_, i) => `p${i}@x.org`).join("\n");
    expect(errorOf(() => parseAllowlistCsv(many)).code).toBe("too_many");
  });
});

describe("normalizeAllowlistEmail", () => {
  it("segue a regra do índice cego: minúsculas e sem espaços nas pontas", () => {
    expect(normalizeAllowlistEmail("  Maria@Exemplo.ORG ")).toBe("maria@exemplo.org");
    expect(normalizeAllowlistEmail("sem-arroba")).toBeNull();
    expect(normalizeAllowlistEmail(`${"a".repeat(250)}@x.org`)).toBeNull();
  });
});
