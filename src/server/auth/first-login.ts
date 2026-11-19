// Ponto de extensão do primeiro login (#9 → #26, ADR 0008 §1).
//
// Chamado quando o perfil está `pending` ou ainda não existe: logo depois do login (callback e
// confirmação do link) e em TODA página autenticada (requireUser), para que quem obtém sessão
// direto pelo /auth/v1 também passe por aqui. A decisão é da #26: `resolveAccessAfterSignIn`
// lê o e-mail com `auth.getUser()` no próprio cliente da sessão, exige `email_confirmed_at`,
// compara o HMAC com a lista e define `profiles.access_status` (uma vez só; idempotente).
//
// Devolve `active`, `waitlisted` ou null (ainda sem perfil: chamar de novo depois de criá-lo).
// Erro (sem sessão, e-mail não confirmado, banco fora) encerra a sessão: falha fechada.
import { resolveAccessAfterSignIn, type AccessClient, type ResolvedAccess } from "@/modules/access";

export type FirstLoginHook = (client: AccessClient) => Promise<ResolvedAccess>;

export const onFirstLogin: FirstLoginHook = (client) => resolveAccessAfterSignIn(client);
