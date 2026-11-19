import "server-only";
import { cookies } from "next/headers";
import { consentTerm } from "@config/consent";
import {
  acceptConsent,
  CONSENT_PATH,
  CONSENT_PENDING_COOKIE,
  consentGate,
  consentPendingMaxAgeSeconds,
  readConsentVersion,
} from "@/modules/privacy";
import { log } from "@/server/log";
import type { AuthClient } from "./client";
import { SIGNOUT_PATH } from "./routes";

// Portão do termo de consentimento (#11). Quem não aceitou a versão atual do termo
// (`config/consent.ts`) só vê a tela do termo. Sem perfil ainda, o aceite fica num cookie curto
// e é gravado no perfil logo depois que ele for salvo (`finishPendingConsent`).

/** Para onde mandar quem ainda não aceitou o termo atual, ou null se pode seguir. Falha fechada. */
export async function consentRedirect(client: AuthClient, userId: string): Promise<string | null> {
  try {
    const profileVersion = await readConsentVersion(client, userId);
    const pendingVersion = (await cookies()).get(CONSENT_PENDING_COOKIE)?.value ?? null;
    return consentGate({ profileVersion, pendingVersion, currentVersion: consentTerm.version }) === "ok" ? null : CONSENT_PATH;
  } catch (err) {
    log.error("consent_check_failed", { reason: err instanceof Error ? err.message.slice(0, 64) : "unknown" });
    return `${SIGNOUT_PATH}?motivo=failed`;
  }
}

/** Guarda o aceite de quem ainda não tem perfil (1 hora; só a versão, nunca dado da pessoa). */
export async function setPendingConsent(secure: boolean): Promise<void> {
  (await cookies()).set(CONSENT_PENDING_COOKIE, consentTerm.version, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: consentPendingMaxAgeSeconds,
  });
}

/**
 * Depois de salvar o perfil: grava o aceite pendente no perfil e apaga o cookie. Se não der, o
 * cookie fica de lado e o portão manda a pessoa de volta ao termo (perfil sem aceite), sem perder
 * o cadastro.
 */
export async function finishPendingConsent(client: AuthClient): Promise<void> {
  const store = await cookies();
  if (store.get(CONSENT_PENDING_COOKIE)?.value !== consentTerm.version) return;
  const result = await acceptConsent(client, consentTerm.version);
  if (result.status === "accepted") store.delete(CONSENT_PENDING_COOKIE);
}
