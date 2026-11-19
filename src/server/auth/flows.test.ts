import { beforeEach, describe, expect, it, vi } from "vitest";

const logged: string[] = [];
vi.mock("@/server/log", () => {
  const write = (event: string, fields?: object) => void logged.push(JSON.stringify({ event, ...fields }));
  return { log: { info: write, warn: write, error: write } };
});

const { completeSignIn, requestMagicLink, startGoogleSignIn } = await import("./flows");
type AuthApi = import("./flows").AuthApi;

const SITE = "https://app.exemplo.org";
const EMAIL = "Pessoa.Teste@Exemplo.org";
const user = { id: "00000000-0000-4000-8000-000000000001", email: "pessoa.teste@exemplo.org" };

function fakeAuth(overrides: Partial<AuthApi> = {}): AuthApi {
  return {
    signInWithOAuth: vi.fn(async () => ({ data: { url: "https://app.exemplo.org/auth/v1/authorize?provider=google" }, error: null })),
    signInWithOtp: vi.fn(async () => ({ error: null })),
    exchangeCodeForSession: vi.fn(async () => ({ data: { user }, error: null })),
    verifyOtp: vi.fn(async () => ({ data: { user }, error: null })),
    signOut: vi.fn(async () => ({ error: null })),
    ...overrides,
  };
}

beforeEach(() => {
  logged.length = 0;
});

describe("startGoogleSignIn (#9)", () => {
  it("devolve o endereço do Google com retorno para /auth/callback", async () => {
    const auth = fakeAuth();
    const result = await startGoogleSignIn(auth, { siteUrl: SITE, next: "/inicio?x=1" });
    expect(result).toEqual({ ok: true, url: expect.stringContaining("/auth/v1/authorize") });
    expect(auth.signInWithOAuth).toHaveBeenCalledWith({
      provider: "google",
      options: { redirectTo: `${SITE}/auth/callback?next=%2Finicio%3Fx%3D1`, skipBrowserRedirect: true },
    });
  });

  it("não deixa o next levar para fora do site", async () => {
    const auth = fakeAuth();
    await startGoogleSignIn(auth, { siteUrl: SITE, next: "//mal.example" });
    expect(vi.mocked(auth.signInWithOAuth).mock.calls[0]?.[0].options.redirectTo).toBe(`${SITE}/auth/callback?next=%2Finicio`);
  });

  it("provedor indisponível vira erro genérico", async () => {
    const auth = fakeAuth({ signInWithOAuth: vi.fn(async () => ({ data: { url: null }, error: { status: 500 } })) });
    expect(await startGoogleSignIn(auth, { siteUrl: SITE })).toEqual({ ok: false, error: "unavailable" });
  });
});

describe("requestMagicLink (#9)", () => {
  it("normaliza o e-mail, cria a conta se preciso e nunca loga o e-mail", async () => {
    const auth = fakeAuth();
    expect(await requestMagicLink(auth, { email: `  ${EMAIL} `, siteUrl: SITE })).toEqual({ ok: true });
    expect(auth.signInWithOtp).toHaveBeenCalledWith({
      email: user.email,
      options: { emailRedirectTo: `${SITE}/auth/callback`, shouldCreateUser: true },
    });
    expect(logged.join()).not.toMatch(/exemplo\.org.*@|@exemplo/i);
  });

  it.each([["sem-arroba"], [""], [null], ["a@b"], [`${"a".repeat(250)}@exemplo.org`]])("recusa e-mail inválido %j sem chamar o Auth", async (email) => {
    const auth = fakeAuth();
    expect(await requestMagicLink(auth, { email, siteUrl: SITE })).toEqual({ ok: false, error: "invalid_email" });
    expect(auth.signInWithOtp).not.toHaveBeenCalled();
  });

  it("rate limit do Auth vira mensagem própria, sem o e-mail no log (R11)", async () => {
    const auth = fakeAuth({
      signInWithOtp: vi.fn(async () => ({ error: { status: 429, code: "over_email_send_rate_limit", message: `limite para ${EMAIL}` } })),
    });
    expect(await requestMagicLink(auth, { email: EMAIL, siteUrl: SITE })).toEqual({ ok: false, error: "rate_limited" });
    expect(logged).toHaveLength(1);
    expect(logged.join()).not.toContain("@");
  });
});

describe("completeSignIn (#9)", () => {
  const params = (query: string) => new URLSearchParams(query);

  it("troca o code, chama o gancho do primeiro login e segue para o destino", async () => {
    const auth = fakeAuth();
    const hook = vi.fn(async () => {});
    expect(await completeSignIn(auth, params("code=abc&next=%2Finicio%3Fa%3D1"), hook)).toEqual({ ok: true, next: "/inicio?a=1" });
    expect(auth.exchangeCodeForSession).toHaveBeenCalledWith("abc");
    expect(hook).toHaveBeenCalledWith({ userId: user.id, email: user.email });
    expect(logged.join()).not.toContain("@");
  });

  it("aceita o token_hash do link mágico (outro navegador)", async () => {
    const auth = fakeAuth();
    expect(await completeSignIn(auth, params("token_hash=h&type=email"), vi.fn(async () => {}))).toEqual({ ok: true, next: "/inicio" });
    expect(auth.verifyOtp).toHaveBeenCalledWith({ token_hash: "h", type: "email" });
  });

  it.each([["type=recovery&token_hash=h"], ["token_hash=h"], [""], ["error=access_denied&error_code=bad_oauth_state"]])(
    "recusa retorno inválido %j sem criar sessão",
    async (query) => {
      const auth = fakeAuth();
      const hook = vi.fn(async () => {});
      expect(await completeSignIn(auth, params(query), hook)).toEqual({ ok: false, error: "failed" });
      expect(auth.exchangeCodeForSession).not.toHaveBeenCalled();
      expect(auth.verifyOtp).not.toHaveBeenCalled();
      expect(hook).not.toHaveBeenCalled();
    },
  );

  it("code expirado ou de outro navegador é negado", async () => {
    const auth = fakeAuth({ exchangeCodeForSession: vi.fn(async () => ({ data: { user: null }, error: { status: 400, code: "flow_state_not_found" } })) });
    const hook = vi.fn(async () => {});
    expect(await completeSignIn(auth, params("code=velho"), hook)).toEqual({ ok: false, error: "failed" });
    expect(hook).not.toHaveBeenCalled();
  });

  it("se o gancho do primeiro login falhar, desfaz a sessão (falha fechada)", async () => {
    const auth = fakeAuth();
    const hook = vi.fn(async () => {
      throw new Error(`falhou para ${EMAIL}`);
    });
    expect(await completeSignIn(auth, params("code=abc"), hook)).toEqual({ ok: false, error: "failed" });
    expect(auth.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(logged.join()).not.toContain("@");
  });
});
