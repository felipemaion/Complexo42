// Aceite do termo (#11) no servidor: só repassa a versão ao banco e falha fechado. As regras do
// banco (quem aceita, auditoria, 'none') estão em supabase/tests/consent.test.sql.
import { describe, expect, it, vi } from "vitest";
import type { ConsentDbClient } from "../types";
import { acceptConsent, readConsentVersion } from "./consent";

vi.mock("server-only", () => ({}));

const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
const USER = "0b6f2d4e-3c1a-4f8e-9d2b-7a5c6e1f0a93";

function rpcClient(result: { data: unknown; error: unknown }) {
  const rpc = vi.fn(async () => result);
  return { client: { rpc } as unknown as ConsentDbClient, rpc };
}

function profileClient(result: { data: unknown; error: unknown }) {
  const maybeSingle = vi.fn(async () => result);
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  return { client: { from: vi.fn(() => ({ select })) } as unknown as ConsentDbClient, eq };
}

describe("acceptConsent", () => {
  it("chama accept_consent com a versão recebida e devolve accepted", async () => {
    const { client, rpc } = rpcClient({ data: "accepted", error: null });
    expect(await acceptConsent(client, "v1", log)).toEqual({ status: "accepted" });
    expect(rpc).toHaveBeenCalledWith("accept_consent", { p_version: "v1" });
  });

  it("sem perfil → no_profile, para o servidor guardar o aceite pendente", async () => {
    const { client } = rpcClient({ data: "no_profile", error: null });
    expect(await acceptConsent(client, "v1", log)).toEqual({ status: "no_profile" });
  });

  it("erro do banco → failed, só com o código no log", async () => {
    const { client } = rpcClient({ data: null, error: { code: "42501", message: "detalhe com Maria" } });
    expect(await acceptConsent(client, "v1", log)).toEqual({ status: "failed" });
    expect(log.error).toHaveBeenCalledWith("consent_accept_failed", { reason: "42501" });
  });

  it("resposta inesperada → failed (falha fechada)", async () => {
    const { client } = rpcClient({ data: "talvez", error: null });
    expect(await acceptConsent(client, "v1", log)).toEqual({ status: "failed" });
  });
});

describe("readConsentVersion", () => {
  it("devolve a versão gravada no perfil", async () => {
    const { client, eq } = profileClient({ data: { consent_version: "v1" }, error: null });
    expect(await readConsentVersion(client, USER)).toBe("v1");
    expect(eq).toHaveBeenCalledWith("id", USER);
  });

  it("sem perfil → null", async () => {
    const { client } = profileClient({ data: null, error: null });
    expect(await readConsentVersion(client, USER)).toBeNull();
  });

  it("erro de leitura propaga (quem chama nega o acesso)", async () => {
    const { client } = profileClient({ data: null, error: { code: "PGRST301" } });
    await expect(readConsentVersion(client, USER)).rejects.toThrow("consent_read_failed:PGRST301");
  });
});
