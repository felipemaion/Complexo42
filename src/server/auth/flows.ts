// Fluxos do login (#9): Google, link mágico, retorno e saída. Recebem o cliente de auth por
// parâmetro para serem testados sem rede. R11: e-mail nunca vai para log nem para a URL.
import { z } from "zod";
import { log } from "@/server/log";
import { classifyAuthError, type AuthApiError, type AuthErrorCode } from "./errors";
import type { FirstLoginHook } from "./first-login";
import { CALLBACK_PATH, safeNextPath } from "./routes";

type AuthUser = { id: string; email?: string | undefined };
type UserResult = Promise<{ data: { user: AuthUser | null }; error: AuthApiError }>;

/** O pedaço de `SupabaseClient["auth"]` que o login usa. */
export type AuthApi = {
  signInWithOAuth(args: {
    provider: "google";
    options: { redirectTo: string; skipBrowserRedirect: boolean };
  }): Promise<{ data: { url: string | null }; error: AuthApiError }>;
  signInWithOtp(args: { email: string; options: { emailRedirectTo: string; shouldCreateUser: boolean } }): Promise<{ error: AuthApiError }>;
  exchangeCodeForSession(code: string): UserResult;
  verifyOtp(args: { token_hash: string; type: OtpType }): UserResult;
  signOut(args: { scope: "local" }): Promise<{ error: AuthApiError }>;
};

export type FlowResult<T = object> = ({ ok: true } & T) | { ok: false; error: AuthErrorCode };

// Tipos de link que o GoTrue manda por e-mail e que o retorno aceita (supabase/templates/).
const otpTypes = ["email", "magiclink", "signup"] as const;
type OtpType = (typeof otpTypes)[number];

const emailSchema = z.string().trim().toLowerCase().max(254).pipe(z.email());

function callbackUrl(siteUrl: string, next?: string): string {
  const url = new URL(CALLBACK_PATH, siteUrl);
  if (next) url.searchParams.set("next", safeNextPath(next));
  return url.toString();
}

/** Monta o endereço do Google (via /auth/v1/authorize, com PKCE). Não faz chamada de rede. */
export async function startGoogleSignIn(auth: AuthApi, opts: { siteUrl: string; next?: string }): Promise<FlowResult<{ url: string }>> {
  const { data, error } = await auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: callbackUrl(opts.siteUrl, opts.next), skipBrowserRedirect: true },
  });
  if (error || !data.url) {
    log.warn("auth_google_start_failed", { status: error?.status, code: error?.code });
    return { ok: false, error: classifyAuthError(error) };
  }
  return { ok: true, url: data.url };
}

/**
 * Pede o link mágico. Cria a conta se não existir: quem entra sem estar na lista de autorizados
 * fica em espera (ADR 0008 §1, #26), então o cadastro não é bloqueado aqui.
 */
export async function requestMagicLink(auth: AuthApi, opts: { email: unknown; siteUrl: string }): Promise<FlowResult> {
  const email = emailSchema.safeParse(opts.email);
  if (!email.success) return { ok: false, error: "invalid_email" };
  const { error } = await auth.signInWithOtp({
    email: email.data,
    options: { emailRedirectTo: callbackUrl(opts.siteUrl), shouldCreateUser: true },
  });
  if (error) {
    log.warn("auth_magic_link_failed", { status: error.status, code: error.code });
    return { ok: false, error: classifyAuthError(error) };
  }
  return { ok: true };
}

/**
 * Retorno do login (/auth/callback): troca o `code` (Google e link mágico PKCE) ou confere o
 * `token_hash` (link mágico do modelo de e-mail, que funciona em outro navegador), cria a
 * sessão e chama o gancho do primeiro login. Se o gancho falhar, desfaz a sessão.
 */
export async function completeSignIn(auth: AuthApi, params: URLSearchParams, onFirstLogin: FirstLoginHook): Promise<FlowResult<{ next: string }>> {
  const code = params.get("code");
  const tokenHash = params.get("token_hash");
  const type = params.get("type");
  if (params.has("error")) {
    log.warn("auth_callback_provider_error", { code: params.get("error_code") ?? params.get("error") });
    return { ok: false, error: "failed" };
  }

  let result: Awaited<UserResult>;
  if (code) result = await auth.exchangeCodeForSession(code);
  else if (tokenHash && (otpTypes as readonly string[]).includes(type ?? "")) {
    result = await auth.verifyOtp({ token_hash: tokenHash, type: type as OtpType });
  } else return { ok: false, error: "failed" };

  const user = result.data.user;
  if (result.error || !user?.email) {
    log.warn("auth_callback_failed", { status: result.error?.status, code: result.error?.code });
    return { ok: false, error: result.error ? classifyAuthError(result.error) : "failed" };
  }

  try {
    await onFirstLogin({ userId: user.id, email: user.email });
  } catch (err) {
    log.error("auth_first_login_hook_failed", { error: err instanceof Error ? err.name : "unknown" });
    await auth.signOut({ scope: "local" });
    return { ok: false, error: "failed" };
  }
  log.info("auth_signed_in", { method: code ? "code" : "token_hash" });
  return { ok: true, next: safeNextPath(params.get("next")) };
}
