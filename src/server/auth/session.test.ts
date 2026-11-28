// endSession (#18): os cookies de sessão são apagados mesmo se o logout no GoTrue falhar
// (depois de excluir a conta, a sessão já não existe lá).
import { beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, string>();
const signOut = vi.fn(async () => ({ error: null }));
// `profiles.access_status` que o cliente de mentira devolve; `"erro"` simula a falha da leitura.
let accessStatus: string = "active";
const getUser = vi.fn(async () => ({ data: { user: { id: "u1", email: "pessoa@exemplo.org" } } }));
const profileQuery = {
  select: () => profileQuery,
  eq: () => profileQuery,
  maybeSingle: async () =>
    accessStatus === "erro" ? { data: null, error: { code: "XX000" } } : { data: { access_status: accessStatus }, error: null },
};
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`REDIRECT:${path}`);
  },
}));
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    getAll: () => [...store].map(([name, value]) => ({ name, value })),
    set: (name: string, value: string) => store.set(name, value),
    delete: (name: string) => store.delete(name),
  }),
  headers: async () => new Headers(),
}));
vi.mock("./config", () => ({
  getAuthConfig: () => ({ internalUrl: "http://127.0.0.1:9", publicUrl: "http://127.0.0.1:9", anonKey: "k", siteUrl: "http://127.0.0.1:3000", trustCfConnectingIp: false }),
}));
vi.mock("./client", async (original) => ({
  ...(await original<typeof import("./client")>()),
  createAuthClient: () => ({ auth: { signOut, getUser }, from: () => profileQuery }),
}));

const { endSession, requireHolderClient } = await import("./session");

beforeEach(() => {
  store.clear();
  store.set("sb-app-auth-token", "a");
  store.set("sb-app-auth-token.1", "b");
  store.set("outro", "fica");
  signOut.mockClear();
});

describe("endSession", () => {
  it("faz o logout local e apaga só os cookies de sessão", async () => {
    await endSession();
    expect(signOut).toHaveBeenCalledWith({ scope: "local" });
    expect([...store.keys()]).toEqual(["outro"]);
  });

  it("logout com erro: os cookies são apagados mesmo assim (e o erro segue para quem chamou)", async () => {
    signOut.mockRejectedValueOnce(new Error("gotrue_down"));
    await expect(endSession()).rejects.toThrow("gotrue_down");
    expect([...store.keys()]).toEqual(["outro"]);
  });
});

// #130, parte 1: quem está em espera baixa os próprios dados, mas o bloqueado NÃO (a parte dos bloqueados espera decisão do
// jurídico). `requireHolderClient` dispensa o portão do termo, da casa e da espera, e mantém o do bloqueio.
describe("requireHolderClient", () => {
  it.each(["active", "waitlisted"])("%s: segue com a sessão", async (status) => {
    accessStatus = status;
    expect((await requireHolderClient()).user.id).toBe("u1");
  });

  it("bloqueado: recusa e manda para o logout, como antes", async () => {
    accessStatus = "blocked";
    await expect(requireHolderClient()).rejects.toThrow("REDIRECT:/auth/sair?motivo=blocked");
  });

  it("falha ao ler o status: recusa (falha fechada) e encerra a sessão", async () => {
    accessStatus = "erro";
    await expect(requireHolderClient()).rejects.toThrow(/REDIRECT:.*motivo=failed/);
  });

  it("sem sessão: login", async () => {
    store.clear();
    await expect(requireHolderClient()).rejects.toThrow(/REDIRECT:\/entrar/);
  });
});
