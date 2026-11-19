import type { DbProbe } from "../types";

type Fetch = (input: string, init: RequestInit) => Promise<Response>;

/**
 * Consulta a URL interna de prontidão do banco (PostgREST /ready, ADR 0009 §1).
 * Nunca lança: devolve o estado e, na falha, um motivo curto só para o log.
 */
export async function probeDb(url: string | undefined, timeoutMs: number, fetchImpl: Fetch = fetch): Promise<DbProbe> {
  if (!url) return { status: "unconfigured" };
  try {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs), cache: "no-store", redirect: "error" });
    await res.body?.cancel();
    return res.ok ? { status: "ok" } : { status: "unavailable", reason: "http_error" };
  } catch (err) {
    const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    return { status: "unavailable", reason: timedOut ? "timeout" : "network" };
  }
}
