// Saúde do app + banco (ADR 0009 §3 e §6). Usado pelo teste de fumaça do deploy e pelo
// monitoramento externo. A resposta não leva dado pessoal nem detalhe de erro.
import { NextResponse } from "next/server";
import { consentTerm } from "@config/consent";
import { appVersion, evaluateHealth, probeDb, probeSchema, probeTerms, type TermVersions } from "@/modules/health";
import { getQuestionnaire } from "@/modules/houses/server/questionnaire";
import { getEnv } from "@/server/env";
import { log } from "@/server/log";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(): Promise<NextResponse> {
  const env = getEnv();
  // As versões que a config espera achar no banco. Questionário ilegível: sem versão, a sonda diz "unconfigured".
  let versions: TermVersions | undefined;
  try {
    versions = { questionnaire: getQuestionnaire().consentTermVersion, general: consentTerm.version };
  } catch {
    log.error("healthz_questionnaire_unreadable", {});
  }
  // As duas sondas em paralelo: uma pergunta se o banco responde, a outra se a
  // API de dados conhece o esquema de hoje. Sequenciais, somariam os timeouts.
  const [db, schema, terms] = await Promise.all([
    probeDb(env.DB_HEALTH_URL, env.HEALTH_TIMEOUT_MS),
    probeSchema(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, env.HEALTH_TIMEOUT_MS),
    probeTerms(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, versions, env.HEALTH_TIMEOUT_MS),
  ]);
  if (db.reason) log.warn("healthz_db_unavailable", { reason: db.reason });
  // Evento PRÓPRIO, e em nível de erro: cache velho não melhora sozinho e o
  // conserto é um comando (`notify pgrst, 'reload schema'`). Misturado com
  // "banco indisponível" mandaria quem está de plantão olhar o lugar errado.
  if (schema.status === "stale") log.error("healthz_schema_stale", {});
  else if (schema.reason) log.warn("healthz_schema_unavailable", { reason: schema.reason });
  // Evento próprio: o conserto é cadastrar a versão que falta (docs/OPERACAO.md) e não depende do resto.
  if (terms.status === "degraded") log.error("healthz_terms_missing", {});
  else if (terms.reason) log.warn("healthz_terms_unavailable", { reason: terms.reason });
  const { httpStatus, body } = evaluateHealth(db.status, schema.status, terms.status, appVersion(env.APP_VERSION, env.GIT_SHA));
  return NextResponse.json(body, { status: httpStatus, headers: { "Cache-Control": "no-store" } });
}
