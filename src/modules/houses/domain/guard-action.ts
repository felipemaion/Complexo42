import { unstable_rethrow } from "next/navigation";
import type { HouseErrorCode } from "../types";

/**
 * Chamada de Server Action que nunca lança (#315). Depois de um deploy, o Next recusa a action do
 * build antigo ("Failed to find Server Action") e a promessa REJEITA; rede caída rejeita do mesmo
 * jeito. Redirect e not-found do Next propagam. A tela recebe uma recusa `app_updated` ("recarregue a página") em vez de uma exceção.
 */
export async function guardAction<T extends { ok: boolean }>(call: () => Promise<T>): Promise<T | { ok: false; error: HouseErrorCode; retryAfterSeconds?: undefined }> {
  try {
    return await call();
  } catch (error) {
    // O Next rejeita a action de propósito para navegar (redirect para o login com a sessão expirada, not-found):
    // isso segue para o RedirectBoundary e não é "app atualizado".
    unstable_rethrow(error);
    return { ok: false, error: "app_updated" };
  }
}
