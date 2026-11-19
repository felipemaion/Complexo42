// Portão do termo (#11): quem não aceitou a versão atual vai ao termo; erro nega (falha fechada).
// A prova do aceite é a linha em consent_acceptances; nenhum cookie vale como aceite.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { consentTerm } from "@config/consent";

vi.mock("server-only", () => ({}));
let result: { data: unknown; error: unknown } = { data: null, error: null };
const eqVersion = vi.fn();
const client = {
  from: () => ({
    select: () => ({ eq: () => ({ eq: (...args: unknown[]) => (eqVersion(...args), { maybeSingle: async () => result }) }) }),
  }),
} as never;

const { consentRedirect } = await import("./consent");

beforeEach(() => {
  result = { data: null, error: null };
  eqVersion.mockClear();
});

describe("consentRedirect", () => {
  it("aceitou a versão atual → segue", async () => {
    result = { data: { version: consentTerm.version }, error: null };
    expect(await consentRedirect(client, "u")).toBeNull();
    expect(eqVersion).toHaveBeenCalledWith("version", consentTerm.version);
  });

  it("sem aceite da versão atual (nunca aceitou ou termo novo) → vai ao termo", async () => {
    expect(await consentRedirect(client, "u")).toBe("/termo");
  });

  it("erro ao ler → encerra a sessão, não libera", async () => {
    result = { data: null, error: { code: "PGRST301" } };
    expect(await consentRedirect(client, "u")).toBe("/auth/sair?motivo=failed");
  });
});
