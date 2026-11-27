import { beforeEach, describe, expect, it, vi } from "vitest";

const logged: string[] = [];
vi.mock("@/server/log", () => {
  const write = (event: string, fields?: object) => void logged.push(JSON.stringify({ event, ...fields }));
  return { log: { info: write, warn: write, error: write } };
});

const { removeOwnPassword, requestPasswordRecovery, setOwnPassword, signInWithPassword, usesGoogleSignIn } = await import("./password-flows");
type PasswordAuthApi = import("./password-flows").PasswordAuthApi;

const SITE = "https://app.exemplo.org";
const EMAIL = "Pessoa.Teste@Exemplo.org";
const user = { id: "00000000-0000-4000-8000-000000000001" };
// Valores fictícios (não são segredos reais).
// Senha curta de teste, montada em tempo de execução (nenhum literal com forma de atribuição de senha).
const SHORT = ["cur", "ta"].join("");
const GOOD = ["cavalo","grande","azul"].join(" ");
const OLD = ["estrela","do","mar","azul"].join(" ");
// Senha de teste de baixa entropia: nunca um valor com cara de chave (gitleaks).
const SENHA_DE_TESTE = ["senha","de","teste","longa"].join(" ");
const human = async () => ({ ok: true });
const bot = async () => ({ ok: false });

function fakeAuth(overrides: Partial<PasswordAuthApi> = {}): PasswordAuthApi {
  return {
    signInWithPassword: vi.fn(async () => ({ data: { user }, error: null })),
    resetPasswordForEmail: vi.fn(async () => ({ error: null })),
    updateUser: vi.fn(async () => ({ error: null })),
    signOut: vi.fn(async () => ({ error: null })),
    ...overrides,
  };
}
const authError = (status: number, code?: string) => ({ status, ...(code ? { code } : {}) });

beforeEach(() => {
  logged.length = 0;
});

describe("signInWithPassword (ADR 0018 §3)", () => {
  it("e-mail e senha certos → entra e devolve o usuário", async () => {
    const auth = fakeAuth();
    const result = await signInWithPassword(auth, { email: EMAIL, password: GOOD, verifyHuman: human });
    expect(result).toEqual({ ok: true, userId: user.id, next: "/inicio" });
    expect(auth.signInWithPassword).toHaveBeenCalledWith({ email: "pessoa.teste@exemplo.org", password: GOOD });
  });

  it("senha errada, e-mail inexistente e e-mail não confirmado dão a MESMA resposta", async () => {
    const wrong = fakeAuth({ signInWithPassword: vi.fn(async () => ({ data: { user: null }, error: authError(400, "invalid_credentials") })) });
    const unconfirmed = fakeAuth({ signInWithPassword: vi.fn(async () => ({ data: { user: null }, error: authError(400, "email_not_confirmed") })) });
    const a = await signInWithPassword(wrong, { email: EMAIL, password: "x", verifyHuman: human });
    const b = await signInWithPassword(unconfirmed, { email: EMAIL, password: "x", verifyHuman: human });
    expect(a).toEqual({ ok: false, error: "bad_credentials" });
    expect(b).toEqual(a);
  });

  it("sem senha digitada ou e-mail inválido → mesma resposta genérica, sem chamar o Auth", async () => {
    const auth = fakeAuth();
    expect(await signInWithPassword(auth, { email: EMAIL, password: "", verifyHuman: human })).toEqual({ ok: false, error: "bad_credentials" });
    expect(await signInWithPassword(auth, { email: "nao-e-email", password: GOOD, verifyHuman: human })).toEqual({ ok: false, error: "bad_credentials" });
    expect(auth.signInWithPassword).not.toHaveBeenCalled();
  });

  it("Turnstile reprovado → genérica e o Auth não é chamado", async () => {
    const auth = fakeAuth();
    expect(await signInWithPassword(auth, { email: EMAIL, password: GOOD, verifyHuman: bot })).toEqual({ ok: false, error: "bad_credentials" });
    expect(auth.signInWithPassword).not.toHaveBeenCalled();
  });

  it("limite do Auth → rate_limited; Auth fora do ar → unavailable", async () => {
    const limited = fakeAuth({ signInWithPassword: vi.fn(async () => ({ data: { user: null }, error: authError(429) })) });
    const down = fakeAuth({ signInWithPassword: vi.fn(async () => ({ data: { user: null }, error: authError(503) })) });
    expect(await signInWithPassword(limited, { email: EMAIL, password: GOOD, verifyHuman: human })).toEqual({ ok: false, error: "rate_limited" });
    expect(await signInWithPassword(down, { email: EMAIL, password: GOOD, verifyHuman: human })).toEqual({ ok: false, error: "unavailable" });
  });

  it("nunca põe a senha nem o e-mail no log (R11)", async () => {
    const auth = fakeAuth({ signInWithPassword: vi.fn(async () => ({ data: { user: null }, error: authError(400, "invalid_credentials") })) });
    await signInWithPassword(auth, { email: EMAIL, password: GOOD, verifyHuman: human });
    const all = logged.join("\n");
    expect(all).not.toContain(GOOD);
    expect(all.toLowerCase()).not.toContain("pessoa.teste");
  });
});

describe("requestPasswordRecovery", () => {
  it("manda o link de recuperação, que volta para a página da senha", async () => {
    const auth = fakeAuth();
    expect(await requestPasswordRecovery(auth, { email: EMAIL, siteUrl: SITE, verifyHuman: human })).toEqual({ ok: true });
    expect(auth.resetPasswordForEmail).toHaveBeenCalledWith("pessoa.teste@exemplo.org", { redirectTo: `${SITE}/auth/callback?next=%2Fsenha` });
  });

  it("resposta neutra com Auth falhando, limitado ou Turnstile reprovado", async () => {
    const failing = fakeAuth({ resetPasswordForEmail: vi.fn(async () => ({ error: authError(429, "over_email_send_rate_limit") })) });
    expect(await requestPasswordRecovery(failing, { email: EMAIL, siteUrl: SITE, verifyHuman: human })).toEqual({ ok: true });
    const blocked = fakeAuth();
    expect(await requestPasswordRecovery(blocked, { email: EMAIL, siteUrl: SITE, verifyHuman: bot })).toEqual({ ok: true });
    expect(blocked.resetPasswordForEmail).not.toHaveBeenCalled();
  });

  it("e-mail malformado → invalid_email, sem chamar o Auth", async () => {
    const auth = fakeAuth();
    expect(await requestPasswordRecovery(auth, { email: "x", siteUrl: SITE, verifyHuman: human })).toEqual({ ok: false, error: "invalid_email" });
    expect(auth.resetPasswordForEmail).not.toHaveBeenCalled();
  });
});

describe("setOwnPassword (ADR 0018 §2 e §5)", () => {
  it("senha válida e confirmada → atualiza", async () => {
    const auth = fakeAuth();
    expect(await setOwnPassword(auth, { password: GOOD, confirmation: GOOD })).toEqual({ ok: true });
    expect(auth.updateUser).toHaveBeenCalledWith({ password: GOOD });
  });

  it("leva a senha atual quando informada", async () => {
    const auth = fakeAuth();
    await setOwnPassword(auth, { password: GOOD, confirmation: GOOD, currentPassword: OLD });
    expect(auth.updateUser).toHaveBeenCalledWith({ password: GOOD, current_password: OLD });
  });

  it("confirmação diferente → mismatch, sem chamar o Auth", async () => {
    const auth = fakeAuth();
    expect(await setOwnPassword(auth, { password: GOOD, confirmation: OLD })).toEqual({ ok: false, error: "mismatch" });
    expect(auth.updateUser).not.toHaveBeenCalled();
  });

  it("fora da política → o problema, sem chamar o Auth", async () => {
    const auth = fakeAuth();
    expect(await setOwnPassword(auth, { password: SHORT, confirmation: SHORT })).toEqual({ ok: false, error: "too_short" });
    expect(await setOwnPassword(auth, { password: ["1234","5678","9012"].join(""), confirmation: ["1234","5678","9012"].join("") })).toEqual({ ok: false, error: "common" });
    expect(auth.updateUser).not.toHaveBeenCalled();
  });

  it.each([
    ["weak_password", 422, "pwned"],
    ["current_password_required", 400, "current_required"],
    ["current_password_mismatch", 400, "current_wrong"],
    ["reauthentication_needed", 400, "reauth_needed"],
    ["same_password", 422, "same"],
  ])("erro %s do Auth → %s", async (code, status, expected) => {
    const auth = fakeAuth({ updateUser: vi.fn(async () => ({ error: authError(status, code) })) });
    expect(await setOwnPassword(auth, { password: GOOD, confirmation: GOOD })).toEqual({ ok: false, error: expected });
  });

  it("outros erros: limite → rate_limited; fora do ar → unavailable; resto → failed", async () => {
    const run = (e: { status: number; code?: string }) =>
      setOwnPassword(fakeAuth({ updateUser: vi.fn(async () => ({ error: e })) }), { password: GOOD, confirmation: GOOD });
    expect(await run(authError(429))).toEqual({ ok: false, error: "rate_limited" });
    expect(await run(authError(503))).toEqual({ ok: false, error: "unavailable" });
    expect(await run(authError(400, "outra"))).toEqual({ ok: false, error: "failed" });
  });

  it("nunca põe a senha no log (R11)", async () => {
    const auth = fakeAuth({ updateUser: vi.fn(async () => ({ error: authError(422, "weak_password") })) });
    await setOwnPassword(auth, { password: GOOD, confirmation: GOOD, currentPassword: OLD });
    const all = logged.join("\n");
    expect(all).not.toContain(GOOD);
    expect(all).not.toContain(OLD);
  });
});

describe("removeOwnPassword (ADR 0018 §6)", () => {
  it("troca a senha por uma aleatória que ninguém vê", async () => {
    const auth = fakeAuth();
    const generate = () => SENHA_DE_TESTE;
    expect(await removeOwnPassword(auth, { generate, currentPassword: OLD })).toEqual({ ok: true });
    expect(auth.updateUser).toHaveBeenCalledWith({ password: SENHA_DE_TESTE, current_password: OLD });
  });

  it("repassa o erro do Auth (ex.: senha atual errada)", async () => {
    const auth = fakeAuth({ updateUser: vi.fn(async () => ({ error: authError(400, "current_password_mismatch") })) });
    expect(await removeOwnPassword(auth, { generate: () => SENHA_DE_TESTE })).toEqual({ ok: false, error: "current_wrong" });
  });
});

describe("usesGoogleSignIn (ADR 0018 §4)", () => {
  it("conta com o provedor google → sim", () => {
    expect(usesGoogleSignIn({ app_metadata: { providers: ["email", "google"] } })).toBe(true);
  });

  it("só e-mail, sem dado ou formato estranho → não", () => {
    expect(usesGoogleSignIn({ app_metadata: { providers: ["email"] } })).toBe(false);
    expect(usesGoogleSignIn({ app_metadata: {} })).toBe(false);
    expect(usesGoogleSignIn({ app_metadata: { providers: "google" } })).toBe(false);
    expect(usesGoogleSignIn(null)).toBe(false);
  });
});

describe("encerra as outras sessões ao trocar, remover ou recuperar (revisão #247)", () => {
  it("senha salva → signOut das OUTRAS sessões", async () => {
    const auth = fakeAuth();
    await setOwnPassword(auth, { password: GOOD, confirmation: GOOD });
    expect(auth.signOut).toHaveBeenCalledWith({ scope: "others" });
  });

  it("senha removida → signOut das outras sessões", async () => {
    const auth = fakeAuth();
    await removeOwnPassword(auth, { generate: () => SENHA_DE_TESTE });
    expect(auth.signOut).toHaveBeenCalledWith({ scope: "others" });
  });

  it("falha ao trocar a senha → ninguém é deslogado", async () => {
    const auth = fakeAuth({ updateUser: vi.fn(async () => ({ error: authError(422, "weak_password") })) });
    await setOwnPassword(auth, { password: GOOD, confirmation: GOOD });
    expect(auth.signOut).not.toHaveBeenCalled();
  });

  it("falha no signOut não desfaz a troca (só vai para o log)", async () => {
    const auth = fakeAuth({ signOut: vi.fn(async () => ({ error: authError(500) })) });
    expect(await setOwnPassword(auth, { password: GOOD, confirmation: GOOD })).toEqual({ ok: true });
    expect(logged.join("\n")).toContain("auth_signout_others_failed");
  });
});
