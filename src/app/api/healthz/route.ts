// Saúde do app + banco (ADR 0009 §3 e §6). Usado pelo teste de fumaça do deploy e pelo
// monitoramento externo. A resposta não leva dado pessoal nem detalhe de erro.
import { NextResponse } from "next/server";
import { appVersion, evaluateHealth, probeDb } from "@/modules/health";
import { getEnv } from "@/server/env";
import { log } from "@/server/log";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(): Promise<NextResponse> {
  const env = getEnv();
  const db = await probeDb(env.DB_HEALTH_URL, env.HEALTH_TIMEOUT_MS);
  if (db.reason) log.warn("healthz_db_unavailable", { reason: db.reason });
  const { httpStatus, body } = evaluateHealth(db.status, appVersion(env.APP_VERSION, env.GIT_SHA));
  return NextResponse.json(body, { status: httpStatus, headers: { "Cache-Control": "no-store" } });
}
