// requestAuthClient: falha ao gravar cookie (Server Component) não derruba a requisição, mas deixa rastro no log.
import { beforeEach, describe, expect, it, vi } from "vitest";

const warn = vi.fn();
const set = vi.fn();
let setAll: ((list: { name: string; value: string; options: object }[]) => void) | undefined;
vi.mock("server-only", () => ({}));
vi.mock("@/server/log", () => ({ log: { warn: (...args: unknown[]) => warn(...args), info: vi.fn(), error: vi.fn() } }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ getAll: () => [], set: (...args: unknown[]) => set(...args), delete: vi.fn() }),
  headers: async () => new Headers(),
}));
vi.mock("./client", async (original) => ({
  ...(await original<typeof import("./client")>()),
  createAuthClient: (opts: { cookies: { setAll: typeof setAll } }) => {
    setAll = opts.cookies.setAll;
    return { auth: {} };
  },
}));

const { requestAuthClient } = await import("./session");
const config = { internalUrl: "http://127.0.0.1:9", publicUrl: "http://127.0.0.1:9", anonKey: "k", siteUrl: "http://127.0.0.1:3000", trustCfConnectingIp: false };

beforeEach(() => {
  warn.mockClear();
  set.mockReset();
});

describe("requestAuthClient.setAll", () => {
  it("grava cada cookie e não loga nada quando dá certo", async () => {
    await requestAuthClient(config);
    setAll!([{ name: "a", value: "1", options: {} }]);
    expect(set).toHaveBeenCalledWith("a", "1", {});
    expect(warn).not.toHaveBeenCalled();
  });

  it("falha do store.set não propaga, e o log leva só o nome do erro (nunca o valor do cookie)", async () => {
    set.mockImplementation(() => {
      throw new TypeError("Cookies can only be modified in a Server Action: valor-secreto");
    });
    await requestAuthClient(config);
    expect(() => setAll!([{ name: "a", value: "valor-secreto", options: {} }])).not.toThrow();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith("auth_cookie_set_failed", { code: "TypeError" });
  });
});
