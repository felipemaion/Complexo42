import type { TermsProbe } from "../types";

type Fetch = (input: string, init: RequestInit) => Promise<Response>;

/** As versões do termo que a config do app espera encontrar no banco. */
export type TermVersions = { questionnaire: string; general: string };

const MOTIVOS = ["questionnaire_missing", "consent_mismatch"] as const;

/**
 * Pergunta ao banco, por `public.term_versions_check` (só leitura, #222), se as versões do termo da
 * config existem. Sem isso o app sobe e o aceite do termo é recusado em silêncio (staging, 2026-11-28:
 * tabela de versões vazia). Vai pelo mesmo caminho e com a mesma chave anon da sonda de esquema.
 *
 * Nunca lança, e a resposta do banco só vira um dos estados conhecidos: nada do corpo vai adiante.
 */
export async function probeTerms(
  baseUrl: string | undefined,
  anonKey: string | undefined,
  versions: TermVersions | undefined,
  timeoutMs: number,
  fetchImpl: Fetch = fetch,
): Promise<TermsProbe> {
  if (!baseUrl || !anonKey || !versions) return { status: "unconfigured" };
  try {
    const res = await fetchImpl(`${baseUrl.replace(/\/$/, "")}/rest/v1/rpc/term_versions_check`, {
      method: "POST",
      headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ p_questionnaire: versions.questionnaire, p_general: versions.general }),
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
      redirect: "error",
    });
    const corpo: unknown = res.ok ? await res.json().catch(() => undefined) : undefined;
    if (corpo === "ok") return { status: "ok" };
    const motivo = MOTIVOS.find((m) => m === corpo);
    if (motivo) return { status: motivo };
    return { status: "unavailable", reason: "http_error" };
  } catch (err) {
    const expirou = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    return { status: "unavailable", reason: expirou ? "timeout" : "network" };
  }
}
