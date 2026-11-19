// Aceite do termo no servidor (#11). A versão vem do `config/consent.ts`, nunca do navegador;
// quem grava é a função `accept_consent`, com o JWT da pessoa (R14; nunca service_role). Só
// códigos em log (R11).
import "server-only";
import { z } from "zod";
import { log as appLog, type Logger } from "@/server/log";
import type { AcceptConsentResult, ConsentDbClient } from "../types";

const profileRow = z.object({ consent_version: z.string() }).nullable();
const acceptOutcome = z.enum(["accepted", "no_profile"]);

/** Só o código do erro (Postgres/PostgREST), nunca a mensagem. */
function errorCode(error: unknown): string {
  const code = typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;
  return typeof code === "string" ? code.slice(0, 16) : "unknown";
}

/** `profiles.consent_version` de `userId`, ou null se a pessoa ainda não tem perfil. Lança se a leitura falhar. */
export async function readConsentVersion(client: ConsentDbClient, userId: string): Promise<string | null> {
  const { data, error } = await client.from("profiles").select("consent_version").eq("id", userId).maybeSingle();
  if (error) throw new Error(`consent_read_failed:${errorCode(error)}`);
  return profileRow.parse(data)?.consent_version ?? null;
}

/** Grava o aceite da `version` para quem está logado. Falha fechada: qualquer dúvida é `failed`. */
export async function acceptConsent(
  client: ConsentDbClient,
  version: string,
  log: Logger = appLog,
): Promise<AcceptConsentResult> {
  const { data, error } = await client.rpc("accept_consent", { p_version: version });
  if (error) {
    log.error("consent_accept_failed", { reason: errorCode(error) });
    return { status: "failed" };
  }
  const outcome = acceptOutcome.safeParse(data);
  if (!outcome.success) {
    log.error("consent_accept_failed", { reason: "unexpected_result" });
    return { status: "failed" };
  }
  return { status: outcome.data };
}
