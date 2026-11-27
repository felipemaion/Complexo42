import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// GET /auth/google (#9): início do login com Google como navegação (302), nunca server action.
const signInWithOAuth = vi.fn();
let config: object | null;
vi.mock("server-only", () => ({}));
vi.mock("@/server/auth/config", () => ({ getAuthConfig: () => config }));
vi.mock("@/server/auth/session", () => ({ requestAuthClient: async () => ({ auth: { signInWithOAuth } }) }));
vi.mock("@/server/log", () => ({ log: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));

const { GET } = await import("./route");
const SITE = "http://127.0.0.1:3000";
const call = (query = "") => GET(new NextRequest(`${SITE}/auth/google${query}`));
const redirectTo = () => new URL(signInWithOAuth.mock.calls[0]![0].options.redirectTo as string);

beforeEach(() => {
  signInWithOAuth.mockReset();
  config = { siteUrl: SITE };
  signInWithOAuth.mockResolvedValue({ data: { url: "http://auth.exemplo/auth/v1/authorize?provider=google" }, error: null });
});

describe("GET /auth/google", () => {
  it("302 para o endereço do Google, sem cache, com retorno ao callback e o destino pedido", async () => {
    const response = await call("?next=%2Fperfil");
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://auth.exemplo/auth/v1/authorize?provider=google");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(signInWithOAuth.mock.calls[0]![0]).toMatchObject({ provider: "google", options: { skipBrowserRedirect: true } });
    expect(redirectTo().pathname).toBe("/auth/callback");
    expect(redirectTo().searchParams.get("next")).toBe("/perfil");
  });

  it("sem Auth configurado: volta a /entrar com erro=unavailable, sem chamar o Auth", async () => {
    config = null;
    const response = await call();
    expect(new URL(response.headers.get("location")!).pathname + new URL(response.headers.get("location")!).search).toBe("/entrar?erro=unavailable");
    expect(signInWithOAuth).not.toHaveBeenCalled();
  });

  it.each(["https://evil.example/x", "//evil.example", "/\\evil.example", "/auth/callback", "javascript:alert(1)"])(
    "next malicioso %s nunca vira destino: cai no início",
    async (next) => {
      await call(`?next=${encodeURIComponent(next)}`);
      expect(redirectTo().origin).toBe(SITE);
      expect(redirectTo().searchParams.get("next")).toBe("/inicio");
    },
  );

  it("erro do Auth: /entrar com o código do erro, nunca a mensagem do Auth", async () => {
    signInWithOAuth.mockResolvedValue({ data: { url: null }, error: { status: 500, code: "unexpected_failure", message: "detalhe interno" } });
    const response = await call();
    const location = response.headers.get("location")!;
    expect(new URL(location).pathname).toBe("/entrar");
    expect(new URL(location).searchParams.get("erro")).toBeTruthy();
    expect(location).not.toContain("detalhe");
  });
});
