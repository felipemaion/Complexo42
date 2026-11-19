// Fluxos do login (#9): Google, link mágico e retorno. Recebem o cliente de auth por parâmetro
// para serem testados sem rede. R11: e-mail nunca vai para log nem para a URL.
//
// A decisão de acesso (lista de autorizados, espera, bloqueio) NÃO fica aqui: fica em
// requireUser (session.ts), que roda em toda página autenticada, inclusive para quem obteve
// sessão sem passar por estes fluxos.
import { z } from "zod";
import { log } from "@/server/log";
import { classifyAuthError, type AuthApiError, type AuthErrorCode } from "./errors";
import { CALLBACK_PATH, safeNextPath } from "./routes";

type UserResult = Promise<{ data: { user: { id: string } | null }; error: AuthApiError }>;

/** O pedaço de `SupabaseClient["auth"]` que o login usa. */
export type AuthApi = {
  signInWithOAuth(args: {
    provider: "google";
    options: { redirectTo: string; skipBrowserRedirect: boolean };
  }): Promise<{ data: { url: string | null }; error: AuthApiError }>;
  signInWithOtp(args: { email: string; options: { emailRedirectTo: string; shouldCreateUser: boolean } }): Promise<{ error: AuthApiError }>;
  exchangeCodeForSession(code: string): UserResult;
  verifyOtp(args: { token_hash: string; type: OtpType }): UserResult;
};

export type FlowResult<T = object> = ({ ok: true } & T) | { ok: false; error: AuthErrorCode };

// Tipos de link que o GoTrue manda por e-mail (supabase/templates/): o mesmo modelo serve ao
// link de quem já tem conta (magiclink) e ao primeiro acesso (signup/confirmação).
export const otpTypes = ["email", "magiclink", "signup"] as const;
export type OtpType = (typeof otpTypes)[number];

const emailSchema = z.string().trim().toLowerCase().max(254).pipe(z.email());

/** Parâmetros do link mágico, validados antes de mostrar a página ou chamar o Auth. */
export const magicLinkParamsSchema = z.object({
  token_hash: z.string().regex(/^[\w-]{8,256}$/),
  type: z.enum(otpTypes),
});

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
 * Pede o link mágico. A resposta é SEMPRE a mesma para um e-mail bem formado, tenha ele conta
 * ou não, esteja o envio limitado ou o Auth fora do ar: a tela não revela quem existe (M4). O
 * motivo real vai só para o log, como código. Quem não está na lista de autorizados fica em
 * espera depois (ADR 0008 §1, #26), então o cadastro não é bloqueado aqui.
 */
export async function requestMagicLink(auth: AuthApi, opts: { email: unknown; siteUrl: string }): Promise<FlowResult> {
  const email = emailSchema.safeParse(opts.email);
  if (!email.success) return { ok: false, error: "invalid_email" };
  const { error } = await auth.signInWithOtp({
    email: email.data,
    options: { emailRedirectTo: callbackUrl(opts.siteUrl), shouldCreateUser: true },
  });
  if (error) log.warn("auth_magic_link_failed", { status: error.status, code: error.code, kind: classifyAuthError(error) });
  return { ok: true };
}

/** Retorno do Google (e do link padrão do GoTrue): troca o `code` do PKCE pela sessão. */
export async function exchangeCode(auth: AuthApi, params: URLSearchParams): Promise<FlowResult<{ next: string; userId: string }>> {
  const code = params.get("code");
  if (params.has("error") || !code) {
    log.warn("auth_callback_rejected", { code: params.get("error_code") ?? params.get("error") ?? "missing_code" });
    return { ok: false, error: "failed" };
  }
  const { data, error } = await auth.exchangeCodeForSession(code);
  if (error || !data.user) {
    log.warn("auth_callback_failed", { status: error?.status, code: error?.code });
    return { ok: false, error: error ? classifyAuthError(error) : "failed" };
  }
  log.info("auth_signed_in", { method: "code" });
  return { ok: true, next: safeNextPath(params.get("next")), userId: data.user.id };
}

/**
 * Link mágico: confere o `token_hash` e cria a sessão. Só é chamado pelo POST do botão
 * "Entrar" da página intermediária: um GET (pré-visualização do e-mail, antivírus) não gasta o
 * token, e ninguém é logado na conta de outra pessoa só por abrir um link (M1/M5).
 */
export async function confirmMagicLink(auth: AuthApi, raw: { token_hash: unknown; type: unknown }): Promise<FlowResult<{ next: string; userId: string }>> {
  const params = magicLinkParamsSchema.safeParse(raw);
  if (!params.success) return { ok: false, error: "failed" };
  const { data, error } = await auth.verifyOtp(params.data);
  if (error || !data.user) {
    log.warn("auth_confirm_failed", { status: error?.status, code: error?.code });
    return { ok: false, error: error ? classifyAuthError(error) : "failed" };
  }
  log.info("auth_signed_in", { method: "token_hash" });
  return { ok: true, next: safeNextPath(null), userId: data.user.id };
}
