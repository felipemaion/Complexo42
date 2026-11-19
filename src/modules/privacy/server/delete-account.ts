// Exclusão da própria conta no servidor (issue #18). Chama `delete_own_account` com o JWT da
// pessoa (R14; nunca service_role, R6): o banco só apaga `auth.uid()` e confere de novo a
// reautenticação. Nada da pessoa vai para log (R11): nem o id, nem o e-mail; só códigos.
import "server-only";
import { log as appLog, type Logger } from "@/server/log";
import { deleteAccountFormSchema } from "../domain/delete-account";
import type { DeleteOwnAccountResult, PrivacyDbClient } from "../types";

export type DeleteDeps = { log: Logger };

const defaultDeps: DeleteDeps = { log: appLog };

/** Só o código do erro (Postgres/PostgREST), nunca a mensagem. */
function errorCode(error: unknown): string {
  const code = typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;
  return typeof code === "string" ? code.slice(0, 16) : "unknown";
}

/**
 * Confere a palavra de confirmação e exclui a conta de quem está logado. `reauth_required`
 * quando o último login tem mais de 10 minutos (o banco decide).
 */
export async function deleteOwnAccount(
  client: PrivacyDbClient,
  input: { confirmation: unknown },
  deps: DeleteDeps = defaultDeps,
): Promise<DeleteOwnAccountResult> {
  if (!deleteAccountFormSchema.safeParse(input).success) return { status: "invalid_confirmation" };
  const { error } = await client.rpc("delete_own_account", {});
  if (error) {
    const code = errorCode(error);
    if (code === "PT401") {
      deps.log.warn("account_delete_reauth_required");
      return { status: "reauth_required" };
    }
    deps.log.error("account_delete_failed", { reason: code });
    return { status: "failed" };
  }
  deps.log.info("account_deleted");
  return { status: "deleted" };
}
