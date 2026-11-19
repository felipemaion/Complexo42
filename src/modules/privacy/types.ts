import type { AuthClient } from "@/server/auth/client";

/**
 * O cliente do Supabase que este módulo usa: **o do servidor com o JWT de quem está logado**
 * (R14). Nunca um cliente com `service_role`. Só `rpc`; nos testes, um falso.
 */
export type PrivacyDbClient = Pick<AuthClient, "rpc">;

/** Resultado da exportação. O corpo só sai no `ok` e nunca vai para log (R11). */
export type ExportOwnDataResult =
  | { status: "ok"; body: string; filename: string }
  | { status: "rate_limited" }
  | { status: "failed" };

/** Resultado da exclusão da conta (#18). */
export type DeleteOwnAccountResult =
  | { status: "deleted" }
  | { status: "invalid_confirmation" }
  | { status: "reauth_required" }
  | { status: "failed" };
