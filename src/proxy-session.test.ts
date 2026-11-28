import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Sessão vencida (timebox de 30 dias, #249): quando o refresh no proxy devolve session_expired ou
// refresh_token_not_found, o proxy limpa os cookies de sessão e manda a pessoa para /entrar com o aviso,
// sem tela de erro. O cliente do GoTrue é simulado; o resto (cookies, rotas) é o real.
const getUser = vi.fn();
type CookieWriter = { cookies: { setAll: (list: { name: string; value: string; options: object }[], headers: Record<string, string>) => void } };
let authOptions: CookieWriter | undefined;
vi.mock("@/server/auth/config", () => ({
  getAuthConfig: () => ({ internalUrl: "http://auth.interno", anonKey: "chave-anon", siteUrl: "https://app.exemplo.org" }),
}));
vi.mock("@/server/auth/client", async (original) => ({
  ...(await original<typeof import("@/server/auth/client")>()),
  createAuthClient: (options: CookieWriter) => {
    authOptions = options;
    return { auth: { getUser } };
  },
}));

import { proxy } from "./proxy";

const withCookies = (path: string, cookies: string) => new NextRequest(`http://localhost${path}`, { headers: { cookie: cookies } });
const setCookies = (response: Response) => response.headers.getSetCookie();

describe("proxy(): sessão vencida", () => {
  beforeEach(() => getUser.mockReset());

  it.each(["session_expired", "refresh_token_not_found"])("%s: limpa os cookies de sessão e leva a /entrar com o aviso", async (code) => {
    getUser.mockResolvedValue({ data: { user: null }, error: { code, status: 400, name: "AuthApiError" } });
    const response = await proxy(withCookies("/inicio", "sb-app-auth-token.0=aaa; sb-app-auth-token.1=bbb; outro=1"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost/entrar?erro=session_expired&next=%2Finicio");
    const cleared = setCookies(response);
    for (const name of ["sb-app-auth-token.0", "sb-app-auth-token.1"]) {
      const line = cleared.find((c) => c.startsWith(`${name}=`));
      expect(line, name).toBeDefined();
      expect(line, name).toMatch(/Max-Age=0|Expires=Thu, 01 Jan 1970/i);
      expect(line, name).toMatch(/HttpOnly/i);
    }
    expect(cleared.some((c) => c.startsWith("outro="))).toBe(false);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("o aviso vale também com o cookie de sessão inteiro (sem pedaços)", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: { code: "session_expired", status: 400 } });
    const response = await proxy(withCookies("/casa", "sb-app-auth-token=aaa"));
    expect(response.headers.get("location")).toBe("http://localhost/entrar?erro=session_expired&next=%2Fcasa");
    expect(setCookies(response).some((c) => c.startsWith("sb-app-auth-token=") && /Max-Age=0|1970/i.test(c))).toBe(true);
  });

  it("em /entrar não há redirecionamento (nada de laço): só limpa os cookies", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: { code: "refresh_token_not_found", status: 400 } });
    const response = await proxy(withCookies("/entrar", "sb-app-auth-token=aaa"));
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    expect(setCookies(response).some((c) => c.startsWith("sb-app-auth-token=") && /Max-Age=0|1970/i.test(c))).toBe(true);
  });

  it("outro erro do GoTrue (rede, 500) não limpa a sessão nem diz que expirou: segue o caminho de quem não entrou", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: { code: "unexpected_failure", status: 500 } });
    const response = await proxy(withCookies("/inicio", "sb-app-auth-token=aaa"));
    expect(response.headers.get("location")).toBe("http://localhost/entrar?next=%2Finicio");
    expect(setCookies(response)).toEqual([]);
  });

  it("sessão válida segue normalmente", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
    const response = await proxy(withCookies("/inicio", "sb-app-auth-token=aaa"));
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });

  it("sessão renovada: a página recebe o cookie novo junto com a CSP (#152), não o refresh token já gasto", async () => {
    // Arrange: o GoTrue renova o token durante o getUser e grava o cookie novo (setAll).
    getUser.mockImplementation(async () => {
      authOptions?.cookies.setAll([{ name: "sb-app-auth-token", value: "novo", options: {} }], {});
      return { data: { user: { id: "u1" } }, error: null };
    });

    // Act
    const response = await proxy(withCookies("/inicio", "sb-app-auth-token=velho; outro=1"));

    // Assert: o Next repassa à página os cabeçalhos x-middleware-request-*.
    const forwardedCookie = response.headers.get("x-middleware-request-cookie") ?? "";
    expect(forwardedCookie).toContain("sb-app-auth-token=novo");
    expect(forwardedCookie).not.toContain("velho");
    expect(response.headers.get("x-middleware-request-x-nonce")).toBeTruthy();
    expect(setCookies(response).some((c) => c.startsWith("sb-app-auth-token=novo"))).toBe(true);
  });
});
