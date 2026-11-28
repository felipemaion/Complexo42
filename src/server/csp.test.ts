import { describe, expect, it } from "vitest";
import { buildCsp, CSP_HEADER, CSP_REPORT_ONLY_HEADER, cspHeaderName, newNonce } from "./csp";

// Contrato da CSP (#152): o que o proxy manda em toda página.
const directives = (csp: string) =>
  Object.fromEntries(
    csp.split(";").map((part) => {
      const [name = "", ...values] = part.trim().split(/\s+/);
      return [name, values];
    }),
  ) as Record<string, string[]>;

const base = { nonce: "bm9uY2UtdGVzdGU=", isDev: false, isHttps: true };
const TURNSTILE = "https://challenges.cloudflare.com";

describe("CSP com nonce (#152)", () => {
  it("scripts: só com o nonce da requisição e 'strict-dynamic', nunca 'unsafe-inline' nem eval em produção", () => {
    // Arrange / Act
    const csp = directives(buildCsp(base));

    // Assert
    expect(csp["script-src"]).toEqual(["'self'", "'nonce-bm9uY2UtdGVzdGU='", "'strict-dynamic'", TURNSTILE]);
    expect(csp["script-src"]).not.toContain("'unsafe-inline'");
    expect(csp["default-src"]).toEqual(["'self'"]);
  });

  it("eval só em desenvolvimento", () => {
    // Arrange / Act
    const dev = directives(buildCsp({ ...base, isDev: true }));

    // Assert
    expect(dev["script-src"]).toContain("'unsafe-eval'");
  });

  it("fecha o que não é usado: plugins, base, ser embutido em outro site e conexões para fora", () => {
    // Arrange / Act
    const csp = directives(buildCsp(base));

    // Assert
    expect(csp["object-src"]).toEqual(["'none'"]);
    expect(csp["base-uri"]).toEqual(["'self'"]);
    expect(csp["frame-ancestors"]).toEqual(["'none'"]);
    expect(csp["connect-src"]).toEqual(["'self'"]);
  });

  it("Turnstile em toda página e só ele como frame: /entrar também abre sem recarregar, com a CSP da página anterior", () => {
    // Arrange: redirect de server action (excluir conta, trocar senha, sessão vencida) leva a /entrar
    // por navegação no cliente; o navegador mantém a CSP do documento em que a pessoa estava.
    // Act
    const csp = directives(buildCsp(base));

    // Assert
    expect(csp["frame-src"]).toEqual([TURNSTILE]);
    expect(csp["script-src"]).toContain(TURNSTILE);
  });

  it("upgrade-insecure-requests só com HTTPS (em http local quebraria os recursos)", () => {
    expect(buildCsp(base)).toContain("upgrade-insecure-requests");
    expect(buildCsp({ ...base, isHttps: false })).not.toContain("upgrade-insecure-requests");
  });

  it("recusa nonce fora do formato (não deixa injetar diretiva)", () => {
    expect(() => buildCsp({ ...base, nonce: "abc'; script-src *" })).toThrow("csp_nonce_invalid");
  });

  it("nonce novo a cada chamada, no formato que o Next reconhece", () => {
    // Arrange / Act
    const first = newNonce();

    // Assert
    expect(first).toMatch(/^[A-Za-z0-9+/_-]+={0,2}$/);
    expect(newNonce()).not.toBe(first);
  });

  it("modo só aviso troca o nome do cabeçalho", () => {
    expect(cspHeaderName(false)).toBe(CSP_HEADER);
    expect(cspHeaderName(true)).toBe(CSP_REPORT_ONLY_HEADER);
  });
});
