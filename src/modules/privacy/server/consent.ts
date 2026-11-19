// Aceite do termo no servidor (#11). A versão vem do `config/consent.ts`, nunca do navegador;
// quem grava é a função `accept_consent`, com o JWT da pessoa (R14; nunca service_role). Só
// códigos em log (R11).
import "server-only";
import { z } from "zod";
import { log as appLog, type Logger } from "@/server/log";
import type { AcceptConsentResult, ConsentDbClient } from "../types";

const acceptedRow = z.object({ version: z.string() }).nullable();
const acceptOutcome = z.literal("accepted");

/** Só o código do erro (Postgres/PostgREST), nunca a mensagem. */
function errorCode(error: unknown): string {
  const code = typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;
  return typeof code === "string" ? code.slice(0, 16) : "unknown";
}

/**
 * Se `userId` aceitou a `version` do termo (linha em `consent_acceptances`, que a RLS só deixa
 * ler para a própria pessoa). Lança se a leitura falhar: quem chama nega o acesso.
 */
export async function hasAcceptedConsent(client: ConsentDbClient, userId: string, version: string): Promise<boolean> {
  const { data, error } = await client
    .from("consent_acceptances")
    .select("version")
    .eq("user_id", userId)
    .eq("version", version)
    .maybeSingle();
  if (error) throw new Error(`consent_read_failed:${errorCode(error)}`);
  return acceptedRow.parse(data) !== null;
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
