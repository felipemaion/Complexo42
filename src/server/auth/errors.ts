// Códigos de erro do login (#9). A tela mostra o texto do config/ para um código conhecido;
// nada que venha da URL é exibido como texto (evita injeção de mensagem).
export const authErrorCodes = ["invalid_email", "rate_limited", "unavailable", "failed", "blocked", "legacy_link"] as const;
export type AuthErrorCode = (typeof authErrorCodes)[number];

export function parseAuthErrorCode(raw: unknown): AuthErrorCode | null {
  return typeof raw === "string" && (authErrorCodes as readonly string[]).includes(raw) ? (raw as AuthErrorCode) : null;
}

/** Erro do Supabase Auth como chega do cliente (só os campos que usamos). */
export type AuthApiError = { status?: number; code?: string; name?: string } | null | undefined;

/** Classifica um erro do GoTrue sem olhar a mensagem (que pode conter o e-mail). */
export function classifyAuthError(error: AuthApiError): AuthErrorCode {
  if (!error) return "failed";
  if (error.status === 429 || error.code === "over_email_send_rate_limit" || error.code === "over_request_rate_limit") {
    return "rate_limited";
  }
  if (error.name === "AuthRetryableFetchError" || !error.status || error.status >= 500) return "unavailable";
  return "failed";
}
