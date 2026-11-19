// endSession (#18): os cookies de sessão são apagados mesmo se o logout no GoTrue falhar
// (depois de excluir a conta, a sessão já não existe lá).
import { beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, string>();
const signOut = vi.fn(async () => ({ error: null }));
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
  createAuthClient: () => ({ auth: { signOut } }),
}));

const { endSession } = await import("./session");

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
