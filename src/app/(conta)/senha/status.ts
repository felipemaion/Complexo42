// Resultado da tela da senha, como vai na URL (`?s=`): só códigos fixos, nunca texto livre nem
// a senha. A tela mostra o texto do config/ para um código conhecido (ADR 0018).
export const PASSWORD_STATUS_PARAM = "s";

export const passwordStatuses = [
  "saved",
  "removed",
  "google",
  "too_short",
  "too_long",
  "common",
  "pwned",
  "mismatch",
  "current_required",
  "current_wrong",
  "reauth_needed",
  "same",
  "rate_limited",
  "unavailable",
  "failed",
] as const;
export type PasswordStatus = (typeof passwordStatuses)[number];

export function parsePasswordStatus(raw: unknown): PasswordStatus | null {
  return typeof raw === "string" && (passwordStatuses as readonly string[]).includes(raw) ? (raw as PasswordStatus) : null;
}
