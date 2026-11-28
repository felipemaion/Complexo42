import type { SchemaProbe } from "../types";

type Fetch = (input: string, init: RequestInit) => Promise<Response>;

/**
 * `profiles`, e não uma tabela de referência: é a tabela que o **login** lê, e
 * foi o 404 dela que quebrou a entrada em 2026-11-27.
 *
 * O motivo é mais fino do que "sondar o que importa". O cache do PostgREST é
 * um retrato do esquema no instante da carga, e o `migra.sh` aplica cada
 * migration em sua própria transação -- então um retrato tirado NO MEIO da
 * sequência pega as tabelas já criadas e não as seguintes. `municipalities`
 * (`20261119140000`) vem antes de `profiles` (`20261119140100`): sondar a
 * primeira daria "ok" num cache que não conhece a segunda. Sondar a última a
 * entrar no caminho do login é o que fecha essa brecha.
 *
 * Uma coluna, uma linha: a leitura é barata.
 */
const SONDA = "/rest/v1/profiles?select=id&limit=1";

/** Código de erro que o PostgREST/Postgres devolve no corpo, quando devolve. */
function codigoDoCorpo(corpo: string): string | undefined {
  try {
    const json: unknown = JSON.parse(corpo);
    const code = (json as { code?: unknown } | null)?.code;
    return typeof code === "string" ? code : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Prova que o PostgREST conhece o esquema ATUAL -- não só que o processo está
 * de pé. O `/ready` dele responde 200 com o cache vazio, e foi assim que o
 * staging passou 19 horas servindo 404 em toda leitura enquanto o healthz
 * seguia verde (2026-11-27 07:09 → 2026-11-28 02:31, cache em 2 relações de
 * 23: o PostgREST subiu antes de o banco terminar de migrar).
 *
 * A sonda vai pela MESMA rede e pelo MESMO Kong que o app usa, com a chave
 * anon -- é o caminho real, não um atalho que só o teste percorre.
 *
 * Os dois códigos que decidem, ambos medidos no staging em 2026-11-28:
 *
 * - `404` + `PGRST205` ("Could not find the table ... in the schema cache"):
 *   o cache não conhece a tabela. É a falha que isto existe para pegar.
 * - `401` + `42501` (`insufficient_privilege`): o PostgREST RESOLVEU a tabela
 *   e o Postgres recusou o papel `anon` -- que é o estado normal, porque
 *   `profiles` tem grant só para `authenticated`. Logo: esquema **ok**.
 *
 * Depender de `42501` em vez de exigir 200 é deliberado: não precisa de grant
 * nenhum para o `anon`, então a sonda não abre leitura de dado para ninguém.
 *
 * Nunca lança: devolve o estado e, na falha, um motivo curto só para o log.
 */
export async function probeSchema(
  baseUrl: string | undefined,
  anonKey: string | undefined,
  timeoutMs: number,
  fetchImpl: Fetch = fetch,
): Promise<SchemaProbe> {
  if (!baseUrl || !anonKey) return { status: "unconfigured" };
  try {
    const res = await fetchImpl(`${baseUrl.replace(/\/$/, "")}${SONDA}`, {
      headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` },
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
      redirect: "error",
    });
    const codigo = codigoDoCorpo(await res.text());
    if (res.ok) return { status: "ok" };
    if (res.status === 404 && codigo === "PGRST205") return { status: "stale" };
    if (codigo === "42501") return { status: "ok" };
    return { status: "unavailable", reason: "http_error" };
  } catch (err) {
    const expirou = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    return { status: "unavailable", reason: expirou ? "timeout" : "network" };
  }
}
