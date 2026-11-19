// Portão de acesso das páginas autenticadas (#9, revisão M2; ADR 0008 §1). Puro: recebe a
// leitura do perfil e o gancho do primeiro login por parâmetro.
import type { AccessStatus } from "@/modules/profiles";

export type AccessDecision = "allow" | "waitlist" | "blocked";

export type AccessDeps = {
  /** `profiles.access_status` de quem está logado, ou null sem perfil. Lança se falhar. */
  readStatus(): Promise<AccessStatus | null>;
  /** Gancho do primeiro login (idempotente). */
  resolve(): Promise<AccessStatus | null>;
};

/**
 * `pending` ou sem perfil → chama o gancho e usa o status que ele devolver. Depois:
 * `waitlisted` → tela de espera; `blocked` → sessão encerrada; o resto segue (sem perfil ainda,
 * a pessoa precisa chegar ao cadastro). Erro em qualquer passo propaga: quem chama encerra a
 * sessão (falha fechada).
 */
export async function checkAccess(deps: AccessDeps): Promise<AccessDecision> {
  let status = await deps.readStatus();
  if (status === null || status === "pending") status = (await deps.resolve()) ?? status;
  if (status === "waitlisted") return "waitlist";
  if (status === "blocked") return "blocked";
  return "allow";
}
