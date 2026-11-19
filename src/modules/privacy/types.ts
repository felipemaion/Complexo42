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

/** O cliente do Supabase do aceite do termo (#11): o da sessão, com `from` (ler a versão) e `rpc`. */
export type ConsentDbClient = Pick<AuthClient, "from" | "rpc">;

/** Resultado do aceite: `no_profile` = ainda não há perfil, o servidor guarda o aceite pendente. */
export type AcceptConsentResult = { status: "accepted" } | { status: "no_profile" } | { status: "failed" };
