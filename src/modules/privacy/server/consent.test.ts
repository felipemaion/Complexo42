// Aceite do termo (#11) no servidor: só repassa a versão ao banco e falha fechado. As regras do
// banco (quem aceita, auditoria, 'none') estão em supabase/tests/consent.test.sql.
import { describe, expect, it, vi } from "vitest";
import type { ConsentDbClient } from "../types";
import { acceptConsent, hasAcceptedConsent } from "./consent";

vi.mock("server-only", () => ({}));

const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
const USER = "0b6f2d4e-3c1a-4f8e-9d2b-7a5c6e1f0a93";

function rpcClient(result: { data: unknown; error: unknown }) {
  const rpc = vi.fn(async () => result);
  return { client: { rpc } as unknown as ConsentDbClient, rpc };
}

function acceptancesClient(result: { data: unknown; error: unknown }) {
  const maybeSingle = vi.fn(async () => result);
  const eqVersion = vi.fn(() => ({ maybeSingle }));
  const eqUser = vi.fn(() => ({ eq: eqVersion }));
  const select = vi.fn(() => ({ eq: eqUser }));
  const from = vi.fn(() => ({ select }));
  return { client: { from } as unknown as ConsentDbClient, from, eqUser, eqVersion };
}

describe("acceptConsent", () => {
  it("chama accept_consent com a versão recebida e devolve accepted", async () => {
    const { client, rpc } = rpcClient({ data: "accepted", error: null });
    expect(await acceptConsent(client, "v1", log)).toEqual({ status: "accepted" });
    expect(rpc).toHaveBeenCalledWith("accept_consent", { p_version: "v1" });
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

describe("hasAcceptedConsent", () => {
  it("há linha da versão para a pessoa → aceitou", async () => {
    const { client, from, eqUser, eqVersion } = acceptancesClient({ data: { version: "v1" }, error: null });
    expect(await hasAcceptedConsent(client, USER, "v1")).toBe(true);
    expect(from).toHaveBeenCalledWith("consent_acceptances");
    expect(eqUser).toHaveBeenCalledWith("user_id", USER);
    expect(eqVersion).toHaveBeenCalledWith("version", "v1");
  });

  it("sem linha (nunca aceitou, ou só uma versão antiga) → não aceitou", async () => {
    const { client } = acceptancesClient({ data: null, error: null });
    expect(await hasAcceptedConsent(client, USER, "v2")).toBe(false);
  });

  it("erro de leitura propaga (quem chama nega o acesso)", async () => {
    const { client } = acceptancesClient({ data: null, error: { code: "PGRST301" } });
    await expect(hasAcceptedConsent(client, USER, "v1")).rejects.toThrow("consent_read_failed:PGRST301");
  });
});
