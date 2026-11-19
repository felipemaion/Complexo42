import "server-only";
import { consentTerm } from "@config/consent";
import { CONSENT_PATH, hasAcceptedConsent } from "@/modules/privacy";
import { log } from "@/server/log";
import type { AuthClient } from "./client";
import { SIGNOUT_PATH } from "./routes";

// Portão do termo de consentimento (#11). Quem não aceitou a versão atual do termo
// (`config/consent.ts`) só vê a tela do termo. A prova é a linha em `consent_acceptances`, ligada
// à conta e gravada só por `accept_consent`; nada que o navegador guarde vale como aceite.

/** Para onde mandar quem ainda não aceitou o termo atual, ou null se pode seguir. Falha fechada. */
export async function consentRedirect(client: AuthClient, userId: string): Promise<string | null> {
  try {
    return (await hasAcceptedConsent(client, userId, consentTerm.version)) ? null : CONSENT_PATH;
  } catch (err) {
    log.error("consent_check_failed", { reason: err instanceof Error ? err.message.slice(0, 64) : "unknown" });
    return `${SIGNOUT_PATH}?motivo=failed`;
  }
}
