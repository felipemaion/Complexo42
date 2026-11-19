/** Estado do banco visto pelo app. Só isso sai na resposta: nada de host, versão ou erro. */
export type DbStatus = "ok" | "unavailable" | "unconfigured";

/** Motivo interno da falha, só para o log da aplicação. */
export type DbFailure = "timeout" | "http_error" | "network";

export type DbProbe = { status: DbStatus; reason?: DbFailure };

export type AppVersion = { tag: string; commit: string };

export type HealthBody = { status: "ok" | "degraded"; version: AppVersion; db: DbStatus };

export type HealthReport = { httpStatus: 200 | 503; body: HealthBody };
