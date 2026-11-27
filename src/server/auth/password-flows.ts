// Fluxos da senha opcional (ADR 0018): entrar com senha, recuperar, definir e remover. O cliente
// de auth entra por parâmetro para testar sem rede. R11: senha e e-mail nunca vão para log nem
// para a URL; só o código do erro do Auth.
import { z } from "zod";
import { log } from "@/server/log";
import { classifyAuthError, type AuthApiError, type AuthErrorCode } from "./errors";
import { callbackUrl, type FlowResult } from "./flows";
import { checkPassword, type PasswordProblem } from "./password-policy";
import { PASSWORD_PATH, safeNextPath } from "./routes";

/** O pedaço de `SupabaseClient["auth"]` que a senha usa. */
export type PasswordAuthApi = {
  signInWithPassword(args: { email: string; password: string }): Promise<{ data: { user: { id: string } | null }; error: AuthApiError }>;
  resetPasswordForEmail(email: string, options: { redirectTo: string }): Promise<{ error: AuthApiError }>;
  updateUser(attributes: { password: string; current_password?: string }): Promise<{ error: AuthApiError }>;
  signOut(options: { scope: "others" }): Promise<{ error: AuthApiError }>;
};

const emailSchema = z.string().trim().toLowerCase().max(254).pipe(z.email());

/**
 * Entra com e-mail e senha. Senha errada, e-mail sem conta, e-mail não confirmado, campo vazio e
 * Turnstile reprovado dão **a mesma** resposta (`bad_credentials`): a tela não revela quem existe
 * (ADR 0018 §3). O acesso (lista de autorizados, espera, bloqueio) NÃO é decidido aqui: o
 * chamador passa por `accessRedirect`, como em qualquer outro login.
 */
export async function signInWithPassword(
  auth: PasswordAuthApi,
  opts: { email: unknown; password: unknown; next?: unknown; verifyHuman: () => Promise<{ ok: boolean }> },
): Promise<FlowResult<{ userId: string; next: string }>> {
  const email = emailSchema.safeParse(opts.email);
  if (!email.success || typeof opts.password !== "string" || opts.password === "") return { ok: false, error: "bad_credentials" };
  if (!(await opts.verifyHuman()).ok) return { ok: false, error: "bad_credentials" };
  const { data, error } = await auth.signInWithPassword({ email: email.data, password: opts.password });
  if (error || !data.user) {
    log.warn("auth_password_login_failed", { status: error?.status, code: error?.code });
    const kind = classifyAuthError(error);
    return { ok: false, error: kind === "failed" ? "bad_credentials" : kind };
  }
  log.info("auth_signed_in", { method: "password" });
  return { ok: true, userId: data.user.id, next: safeNextPath(typeof opts.next === "string" ? opts.next : null) };
}

/**
 * Pede o link para criar uma nova senha. Como no link de entrada, a resposta é sempre a mesma
 * para um e-mail bem formado, tenha ele conta ou não, esteja o envio limitado ou o Auth fora do ar.
 */
export async function requestPasswordRecovery(
  auth: PasswordAuthApi,
  opts: { email: unknown; siteUrl: string; verifyHuman: () => Promise<{ ok: boolean }> },
): Promise<FlowResult> {
  const email = emailSchema.safeParse(opts.email);
  if (!email.success) return { ok: false, error: "invalid_email" };
  if (!(await opts.verifyHuman()).ok) return { ok: true };
  const { error } = await auth.resetPasswordForEmail(email.data, { redirectTo: callbackUrl(opts.siteUrl, PASSWORD_PATH) });
  if (error) log.warn("auth_recovery_failed", { status: error.status, code: error.code, kind: classifyAuthError(error) });
  return { ok: true };
}

export type SetPasswordError =
  | PasswordProblem
  | "mismatch"
  | "pwned"
  | "current_required"
  | "current_wrong"
  | "reauth_needed"
  | "same"
  | Extract<AuthErrorCode, "rate_limited" | "unavailable" | "failed">;
export type SetPasswordResult = { ok: true } | { ok: false; error: SetPasswordError };

// Códigos do GoTrue (internal/api/user.go) → o que a tela explica. O código vem do campo
// `code`, nunca da mensagem, que pode repetir o que a pessoa digitou.
const authCodeToError: ReadonlyMap<string, SetPasswordError> = new Map<string, SetPasswordError>([
  ["weak_password", "pwned"],
  ["current_password_required", "current_required"],
  ["current_password_mismatch", "current_wrong"],
  ["reauthentication_needed", "reauth_needed"],
  ["same_password", "same"],
]);

async function updatePassword(auth: PasswordAuthApi, password: string, currentPassword: string | undefined): Promise<SetPasswordResult> {
  const { error } = await auth.updateUser({ password, ...(currentPassword ? { current_password: currentPassword } : {}) });
  if (!error) {
    // Senha nova invalida as outras sessões (revisão #247): quem tinha a senha antiga, ou um
    // aparelho perdido, sai. Falhar aqui não desfaz a troca; só vai para o log.
    const { error: signOutError } = await auth.signOut({ scope: "others" });
    if (signOutError) log.warn("auth_signout_others_failed", { status: signOutError.status, code: signOutError.code });
    return { ok: true };
  }
  log.warn("auth_password_update_failed", { status: error.status, code: error.code });
  const known = error.code ? authCodeToError.get(error.code) : undefined;
  if (known) return { ok: false, error: known };
  const kind = classifyAuthError(error);
  return { ok: false, error: kind === "rate_limited" || kind === "unavailable" ? kind : "failed" };
}

/** Cria ou troca a senha de quem está logado. A política vale aqui antes de chamar o Auth. */
export async function setOwnPassword(
  auth: PasswordAuthApi,
  opts: { password: unknown; confirmation: unknown; currentPassword?: string },
): Promise<SetPasswordResult> {
  const problem = checkPassword(opts.password);
  if (problem) return { ok: false, error: problem };
  if (opts.password !== opts.confirmation) return { ok: false, error: "mismatch" };
  return updatePassword(auth, opts.password as string, opts.currentPassword);
}

/**
 * Remove a senha: o GoTrue não tem remoção, então ela é trocada por uma aleatória que ninguém
 * vê (ADR 0018 §6). `generate` entra por parâmetro para o teste não depender de aleatoriedade.
 */
export function removeOwnPassword(auth: PasswordAuthApi, opts: { generate: () => string; currentPassword?: string }): Promise<SetPasswordResult> {
  return updatePassword(auth, opts.generate(), opts.currentPassword);
}

/**
 * A conta entra pelo Google? Quem entra por ele não usa senha (ADR 0018 §4). Falha fechado para
 * o outro lado: dado ausente ou fora do formato conta como "não usa Google", e a decisão final
 * de aceitar a senha continua sendo do Auth.
 */
export function usesGoogleSignIn(user: { app_metadata?: { providers?: unknown } } | null | undefined): boolean {
  const providers = user?.app_metadata?.providers;
  return Array.isArray(providers) && providers.includes("google");
}
