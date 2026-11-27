// Códigos de erro do login (#9). A tela mostra o texto do config/ para um código conhecido;
// nada que venha da URL é exibido como texto (evita injeção de mensagem).
export const authErrorCodes = ["invalid_email", "rate_limited", "unavailable", "failed", "blocked", "legacy_link", "session_expired"] as const;
export type AuthErrorCode = (typeof authErrorCodes)[number];

export function parseAuthErrorCode(raw: unknown): AuthErrorCode | null {
  return typeof raw === "string" && (authErrorCodes as readonly string[]).includes(raw) ? (raw as AuthErrorCode) : null;
}

/** Erro do Supabase Auth como chega do cliente (só os campos que usamos). */
export type AuthApiError = { status?: number; code?: string; name?: string } | null | undefined;

/**
 * A sessão acabou (timebox de 30 dias, #249) ou o GoTrue não conhece mais o refresh token: não adianta
 * tentar de novo, só entrar outra vez. Só pelo código do erro, nunca pela mensagem.
 */
export function isExpiredSession(error: AuthApiError): boolean {
  return error?.code === "session_expired" || error?.code === "refresh_token_not_found" || error?.code === "session_not_found";
}

/** Classifica um erro do GoTrue sem olhar a mensagem (que pode conter o e-mail). */
export function classifyAuthError(error: AuthApiError): AuthErrorCode {
  if (!error) return "failed";
  if (error.status === 429 || error.code === "over_email_send_rate_limit" || error.code === "over_request_rate_limit") {
    return "rate_limited";
  }
  if (error.name === "AuthRetryableFetchError" || !error.status || error.status >= 500) return "unavailable";
  return "failed";
}
