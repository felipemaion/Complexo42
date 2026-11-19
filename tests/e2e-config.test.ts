// Contrato do playwright.config.ts com o job "E2E com banco" (#21): a chave de serviço do
// Supabase local fica só no processo de teste, nunca no app (R6), e o app usa a mesma
// BLIND_INDEX_KEY que os testes usam para calcular o HMAC da lista de autorizados.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

describe("playwright.config.ts", () => {
  let webServerEnv: Record<string, string | undefined>;

  beforeAll(async () => {
    vi.stubEnv("E2E_LIVE_SERVICE_KEY", "chave-de-servico-do-teste");
    vi.stubEnv("E2E_LIVE_SERVICE_ROLE_KEY", "chave-de-servico-do-teste");
    vi.stubEnv("E2E_BLIND_INDEX_KEY", "");
    const config = (await import("../playwright.config")).default;
    const webServer = config.webServer;
    if (!webServer || Array.isArray(webServer)) throw new Error("webServer único esperado");
    webServerEnv = webServer.env ?? {};
  });
  afterAll(() => vi.unstubAllEnvs());

  it("tira do ambiente do app as chaves de serviço que o processo de teste recebeu", () => {
    // Valor undefined: o Playwright passa o env ao spawn, que omite a variável no processo filho.
    for (const name of ["E2E_LIVE_SERVICE_KEY", "E2E_LIVE_SERVICE_ROLE_KEY"]) {
      expect(name in webServerEnv).toBe(true);
      expect(webServerEnv[name]).toBeUndefined();
    }
    expect(Object.values(webServerEnv)).not.toContain("chave-de-servico-do-teste");
  });

  it("gera a BLIND_INDEX_KEY de teste uma vez e a compartilha com os testes", () => {
    const key = process.env.E2E_BLIND_INDEX_KEY;
    expect(Buffer.from(key ?? "", "base64")).toHaveLength(32);
    expect(webServerEnv.BLIND_INDEX_KEY).toBe(key);
    expect(webServerEnv.FIELD_ENCRYPTION_KEY).not.toBe(key);
  });
});
