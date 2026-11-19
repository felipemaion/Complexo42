import type { AppVersion, DbStatus, HealthReport } from "../types";

/** Versão gravada na imagem (ARG GIT_SHA / APP_VERSION); fora dela, "dev". */
export function appVersion(tag: string | undefined, commit: string | undefined): AppVersion {
  return { tag: tag ?? "dev", commit: commit ? commit.slice(0, 12) : "unknown" };
}

/** 200 só quando app e banco respondem; qualquer outro estado do banco é 503. */
export function evaluateHealth(db: DbStatus, version: AppVersion): HealthReport {
  const healthy = db === "ok";
  return { httpStatus: healthy ? 200 : 503, body: { status: healthy ? "ok" : "degraded", version, db } };
}
