// Portão do termo (#11): quem não aceitou a versão atual vai ao termo; erro nega (falha fechada);
// o aceite pendente de quem não tinha perfil é gravado depois que o perfil existe.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { consentTerm } from "@config/consent";
import { CONSENT_PENDING_COOKIE } from "@/modules/privacy";

vi.mock("server-only", () => ({}));
const store = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (store.has(name) ? { name, value: store.get(name) } : undefined),
    set: (name: string, value: string) => store.set(name, value),
    delete: (name: string) => store.delete(name),
  }),
}));
let profileResult: { data: unknown; error: unknown } = { data: null, error: null };
const rpc = vi.fn(async (): Promise<{ data: unknown; error: unknown }> => ({ data: "accepted", error: null }));
const client = {
  rpc,
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => profileResult }) }) }),
} as never;

const { consentRedirect, finishPendingConsent, setPendingConsent } = await import("./consent");

beforeEach(() => {
  store.clear();
  rpc.mockClear();
  profileResult = { data: null, error: null };
});

describe("consentRedirect", () => {
  it("perfil na versão atual → segue", async () => {
    profileResult = { data: { consent_version: consentTerm.version }, error: null };
    expect(await consentRedirect(client, "u")).toBeNull();
  });

  it("perfil novo ('none') → vai ao termo", async () => {
    profileResult = { data: { consent_version: "none" }, error: null };
    expect(await consentRedirect(client, "u")).toBe("/termo");
  });

  it("versão antiga → vai ao termo (nova versão exige novo aceite)", async () => {
    profileResult = { data: { consent_version: "v0-antiga" }, error: null };
    expect(await consentRedirect(client, "u")).toBe("/termo");
  });

  it("sem perfil e sem cookie → vai ao termo; com o cookie da versão atual → segue", async () => {
    expect(await consentRedirect(client, "u")).toBe("/termo");
    store.set(CONSENT_PENDING_COOKIE, consentTerm.version);
    expect(await consentRedirect(client, "u")).toBeNull();
  });

  it("cookie de outra versão não vale", async () => {
    store.set(CONSENT_PENDING_COOKIE, "v0-antiga");
    expect(await consentRedirect(client, "u")).toBe("/termo");
  });

  it("erro ao ler o perfil → encerra a sessão, não libera", async () => {
    profileResult = { data: null, error: { code: "PGRST301" } };
    expect(await consentRedirect(client, "u")).toBe("/auth/sair?motivo=failed");
  });
});

describe("pendente de quem ainda não tinha perfil", () => {
  it("setPendingConsent guarda só a versão", async () => {
    await setPendingConsent(false);
    expect([...store]).toEqual([[CONSENT_PENDING_COOKIE, consentTerm.version]]);
  });

  it("depois do perfil salvo, grava o aceite e apaga o cookie", async () => {
    store.set(CONSENT_PENDING_COOKIE, consentTerm.version);
    await finishPendingConsent(client);
    expect(rpc).toHaveBeenCalledWith("accept_consent", { p_version: consentTerm.version });
    expect(store.size).toBe(0);
  });

  it("sem cookie, não chama o banco", async () => {
    await finishPendingConsent(client);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("se a gravação falhar, o cookie fica (o portão leva ao termo)", async () => {
    store.set(CONSENT_PENDING_COOKIE, consentTerm.version);
    rpc.mockResolvedValueOnce({ data: null, error: { code: "XX000" } });
    await finishPendingConsent(client);
    expect(store.has(CONSENT_PENDING_COOKIE)).toBe(true);
  });
});
