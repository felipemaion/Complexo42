/** Estado do banco visto pelo app. Só isso sai na resposta: nada de host, versão ou erro. */
export type DbStatus = "ok" | "unavailable" | "unconfigured";

/** Motivo interno da falha, só para o log da aplicação. */
export type DbFailure = "timeout" | "http_error" | "network";

export type DbProbe = { status: DbStatus; reason?: DbFailure };

/**
 * Estado do ESQUEMA visto pela API de dados. `stale` é o cache do PostgREST
 * sem as tabelas que as migrations já criaram -- processo vivo, API inútil.
 */
export type SchemaStatus = "ok" | "stale" | "unavailable" | "unconfigured";

export type SchemaProbe = { status: SchemaStatus; reason?: DbFailure };

/**
 * As versões do termo da config no banco (#222). `questionnaire_missing` e `consent_mismatch` são só
 * para o log: o corpo do healthz mostra apenas ok ou degradado.
 */
export type TermsStatus = "ok" | "questionnaire_missing" | "consent_mismatch" | "unavailable" | "unconfigured";

export type TermsProbe = { status: TermsStatus; reason?: DbFailure };

export type AppVersion = { tag: string; commit: string };

export type HealthBody = { status: "ok" | "degraded"; version: AppVersion; db: DbStatus; schema: SchemaStatus; terms: "ok" | "degraded" };

export type HealthReport = { httpStatus: 200 | 503; body: HealthBody };
