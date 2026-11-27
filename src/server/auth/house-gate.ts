import "server-only";
import { instance } from "@config/instance";
import { log } from "@/server/log";
import type { AuthClient } from "./client";
import { SIGNOUT_PATH } from "./routes";

// Portão da casa (ADR 0017): quem tem acesso liberado e ainda não tem a casa aceita só vê a tela da casa.
// A prova é o vínculo aberto e aceito em `house_members` (RLS: a própria pessoa lê o seu); nada que o
// navegador guarde vale. Quem ainda não tem linha em `profiles` (fora da lista de autorizados: o perfil
// vem antes, depois a espera) não passa por aqui: não tem casa nem como aceitar uma.

/** A tela da casa: o próximo passo de quem ainda não tem casa. */
export const HOUSE_PATH = "/casa";

/**
 * Para onde mandar quem ainda não tem a casa aceita, ou null se pode seguir. Falha fechada.
 *
 * ATENÇÃO: só vale DEPOIS de `requireAccessUser` (sessão conferida, acesso liberado) e do termo: esta função não
 * confere sessão nem acesso, só a casa. Quem chama é `requireUser` (session.ts), nesta ordem: acesso, termo, casa.
 */
export async function houseRedirect(client: AuthClient, userId: string): Promise<string | null> {
  try {
    const house = await client
      .from("house_members")
      .select("house_key")
      .eq("profile_id", userId)
      .is("left_at", null)
      .not("accepted_at", "is", null)
      .maybeSingle();
    if (house.error) throw new Error(house.error.code ?? "house_read_failed");
    const row = house.data as { house_key?: unknown } | null;
    if (row && instance.houses.some((h) => h.id === row.house_key)) return null;
    const profile = await client.from("profiles").select("id").eq("id", userId).maybeSingle();
    if (profile.error) throw new Error(profile.error.code ?? "profile_read_failed");
    return profile.data === null ? null : HOUSE_PATH;
  } catch (err) {
    log.error("house_check_failed", { reason: err instanceof Error ? err.message.slice(0, 64) : "unknown" });
    return `${SIGNOUT_PATH}?motivo=failed`;
  }
}
