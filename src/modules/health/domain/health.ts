import type { AppVersion, DbStatus, HealthReport, SchemaStatus } from "../types";

/** Versão gravada na imagem (ARG GIT_SHA / APP_VERSION); fora dela, "dev". */
export function appVersion(tag: string | undefined, commit: string | undefined): AppVersion {
  return { tag: tag ?? "dev", commit: commit ? commit.slice(0, 12) : "unknown" };
}

/**
 * 200 só quando app, banco **e esquema** respondem. O esquema entra porque
 * "banco de pé" e "API de dados utilizável" são coisas diferentes: com o cache
 * do PostgREST velho, o `/ready` dá 200 e toda leitura dá 404.
 */
export function evaluateHealth(db: DbStatus, schema: SchemaStatus, version: AppVersion): HealthReport {
  const healthy = db === "ok" && schema === "ok";
  return { httpStatus: healthy ? 200 : 503, body: { status: healthy ? "ok" : "degraded", version, db, schema } };
}
