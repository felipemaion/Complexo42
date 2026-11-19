import { beforeEach, describe, expect, it, vi } from "vitest";

const logged: string[] = [];
vi.mock("@/server/log", () => {
  const write = (event: string, fields?: object) => void logged.push(JSON.stringify({ event, ...fields }));
  return { log: { info: write, warn: write, error: write } };
});

const { confirmMagicLink, exchangeCode, requestMagicLink, startGoogleSignIn } = await import("./flows");
type AuthApi = import("./flows").AuthApi;

const SITE = "https://app.exemplo.org";
const EMAIL = "Pessoa.Teste@Exemplo.org";
const user = { id: "00000000-0000-4000-8000-000000000001", email: "pessoa.teste@exemplo.org" };
// Turnstile (#116) aprovado; os casos de recusa estão no describe próprio.
const human = async () => ({ ok: true });
// Valor fictício e de baixa entropia (não parece segredo para o gitleaks).
const HASH = "h".repeat(16);

function fakeAuth(overrides: Partial<AuthApi> = {}): AuthApi {
  return {
    signInWithOAuth: vi.fn(async () => ({ data: { url: "https://app.exemplo.org/auth/v1/authorize?provider=google" }, error: null })),
    signInWithOtp: vi.fn(async () => ({ error: null })),
    exchangeCodeForSession: vi.fn(async () => ({ data: { user }, error: null })),
    verifyOtp: vi.fn(async () => ({ data: { user }, error: null })),
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
    expect(await requestMagicLink(auth, { email: `  ${EMAIL} `, siteUrl: SITE, verifyHuman: human })).toEqual({ ok: true });
    expect(auth.signInWithOtp).toHaveBeenCalledWith({
      email: user.email,
      options: { emailRedirectTo: `${SITE}/auth/callback`, shouldCreateUser: true },
    });
    expect(logged.join()).not.toMatch(/exemplo\.org.*@|@exemplo/i);
  });

  it.each([["sem-arroba"], [""], [null], ["a@b"], [`${"a".repeat(250)}@exemplo.org`]])("recusa e-mail inválido %j sem chamar o Auth", async (email) => {
    const auth = fakeAuth();
    expect(await requestMagicLink(auth, { email, siteUrl: SITE, verifyHuman: human })).toEqual({ ok: false, error: "invalid_email" });
    expect(auth.signInWithOtp).not.toHaveBeenCalled();
  });

  it("M4: e-mail com e sem conta, limitado ou Auth fora do ar dão a MESMA resposta; o motivo vai só ao log", async () => {
    const outcomes = [
      null,
      { status: 422, code: "signup_disabled", message: `não existe ${EMAIL}` },
      { status: 429, code: "over_email_send_rate_limit" },
      { name: "AuthRetryableFetchError", status: 0 },
    ];
    const results = [];
    for (const error of outcomes) {
      results.push(await requestMagicLink(fakeAuth({ signInWithOtp: vi.fn(async () => ({ error })) }), { email: EMAIL, siteUrl: SITE, verifyHuman: human }));
    }
    expect(new Set(results.map((r) => JSON.stringify(r))).size).toBe(1);
    expect(results[0]).toEqual({ ok: true });
    expect(logged.join()).toContain("signup_disabled");
    expect(logged.join()).toContain("rate_limited");
    expect(logged.join()).not.toContain("@");
  });
});

describe("requestMagicLink + Turnstile (#116)", () => {
  it("Turnstile recusado: não chama o Auth e dá a mesma resposta neutra", async () => {
    const auth = fakeAuth();
    const verifyHuman = vi.fn(async () => ({ ok: false }));
    expect(await requestMagicLink(auth, { email: EMAIL, siteUrl: SITE, verifyHuman })).toEqual({ ok: true });
    expect(verifyHuman).toHaveBeenCalledOnce();
    expect(auth.signInWithOtp).not.toHaveBeenCalled();
  });

  it("e-mail inválido é recusado antes de gastar uma verificação", async () => {
    const verifyHuman = vi.fn(human);
    await requestMagicLink(fakeAuth(), { email: "sem-arroba", siteUrl: SITE, verifyHuman });
    expect(verifyHuman).not.toHaveBeenCalled();
  });

  it("só pede o link depois de o Turnstile aprovar", async () => {
    const order: string[] = [];
    const auth = fakeAuth({ signInWithOtp: vi.fn(async () => (order.push("auth"), { error: null })) });
    await requestMagicLink(auth, { email: EMAIL, siteUrl: SITE, verifyHuman: async () => (order.push("turnstile"), { ok: true }) });
    expect(order).toEqual(["turnstile", "auth"]);
  });
});

describe("exchangeCode (#9): retorno do Google", () => {
  const params = (query: string) => new URLSearchParams(query);

  it("troca o code e segue para o destino", async () => {
    const auth = fakeAuth();
    expect(await exchangeCode(auth, params("code=abc&next=%2Finicio%3Fa%3D1"))).toEqual({ ok: true, next: "/inicio?a=1", userId: user.id });
    expect(auth.exchangeCodeForSession).toHaveBeenCalledWith("abc");
  });

  it("destino que escapa do site vira a página inicial (H1)", async () => {
    expect(await exchangeCode(fakeAuth(), params("code=abc&next=%2F.%2F%2Fmal.example"))).toEqual({ ok: true, next: "/inicio", userId: user.id });
  });

  it.each([[""], ["error=access_denied&error_code=bad_oauth_state"], ["token_hash=h&type=email"]])("recusa %j sem criar sessão", async (query) => {
    const auth = fakeAuth();
    expect(await exchangeCode(auth, params(query))).toEqual({ ok: false, error: "failed" });
    expect(auth.exchangeCodeForSession).not.toHaveBeenCalled();
    expect(auth.verifyOtp).not.toHaveBeenCalled();
  });

  it("code expirado ou de outro navegador é negado", async () => {
    const auth = fakeAuth({ exchangeCodeForSession: vi.fn(async () => ({ data: { user: null }, error: { status: 400, code: "flow_state_not_found" } })) });
    expect(await exchangeCode(auth, params("code=velho"))).toEqual({ ok: false, error: "failed" });
  });
});

describe("confirmMagicLink (#9): POST do botão Entrar", () => {
  it.each([["email"], ["magiclink"], ["signup"]])("confere o token_hash do tipo %s", async (type) => {
    const auth = fakeAuth();
    expect(await confirmMagicLink(auth, { token_hash: HASH, type })).toEqual({ ok: true, next: "/inicio", userId: user.id });
    expect(auth.verifyOtp).toHaveBeenCalledWith({ token_hash: HASH, type });
  });

  it.each([
    [{ token_hash: HASH, type: "recovery" }],
    [{ token_hash: "curto", type: "email" }],
    [{ token_hash: "x".repeat(300), type: "email" }],
    [{ token_hash: "<script>abc", type: "email" }],
    [{ token_hash: null, type: "email" }],
  ])("recusa parâmetros inválidos %j sem chamar o Auth", async (raw) => {
    const auth = fakeAuth();
    expect(await confirmMagicLink(auth, raw)).toEqual({ ok: false, error: "failed" });
    expect(auth.verifyOtp).not.toHaveBeenCalled();
  });

  it("token já usado é negado", async () => {
    const auth = fakeAuth({ verifyOtp: vi.fn(async () => ({ data: { user: null }, error: { status: 403, code: "otp_expired" } })) });
    expect(await confirmMagicLink(auth, { token_hash: HASH, type: "email" })).toEqual({ ok: false, error: "failed" });
  });
});
