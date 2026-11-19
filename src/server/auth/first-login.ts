// Ponto de extensão do primeiro login (#9 → #26, ADR 0008 §1).
//
// `requireUser` chama este gancho sempre que o perfil está `pending` ou ainda não existe, em
// TODA página autenticada, e não só no /auth/callback: quem obtém sessão direto pelo /auth/v1
// também passa por aqui. A #26 implementa a decisão em `resolveAccessAfterSignIn`
// (src/modules/access): lê o e-mail com `auth.getUser()` no próprio cliente da sessão, exige
// `email_confirmed_at`, compara o HMAC com a lista e define `profiles.access_status`.
//
// Contrato:
// - Recebe o cliente Supabase da sessão (JWT do usuário; a RLS vale). Nunca o e-mail como
//   parâmetro, para ninguém pedir a decisão com o e-mail de outra pessoa.
// - Idempotente: pode ser chamado várias vezes para a mesma pessoa.
// - Devolve o status resultante, ou null se ainda não há perfil.
// - Se lançar erro, a sessão é encerrada (falha fechada).
import type { AccessStatus } from "@/modules/profiles";

export type AccessResolverClient = {
  auth: { getUser(): PromiseLike<{ data: { user: unknown }; error: unknown }> };
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
};

export type FirstLoginHook = (client: AccessResolverClient) => Promise<AccessStatus | null>;

/**
 * Stub até a #26 entrar. A ligação é um commit pequeno:
 *   import { resolveAccessAfterSignIn } from "@/modules/access";
 *   export const onFirstLogin: FirstLoginHook = (client) => resolveAccessAfterSignIn(client);
 */
export const onFirstLogin: FirstLoginHook = async () => null;
