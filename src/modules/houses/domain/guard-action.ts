import type { HouseErrorCode } from "../types";

/**
 * Chamada de Server Action que nunca lança (#315). Depois de um deploy, o Next recusa a action do
 * build antigo ("Failed to find Server Action") e a promessa REJEITA; rede caída rejeita do mesmo
 * jeito. A tela recebe uma recusa `app_updated` ("recarregue a página") em vez de uma exceção.
 */
export async function guardAction<T extends { ok: boolean }>(call: () => Promise<T>): Promise<T | { ok: false; error: HouseErrorCode; retryAfterSeconds?: undefined }> {
  try {
    return await call();
  } catch {
    return { ok: false, error: "app_updated" };
  }
}
