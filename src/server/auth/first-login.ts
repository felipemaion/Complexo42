// Ponto de extensão do primeiro login (#9 → #26, ADR 0008 §1).
//
// Depois que a sessão é criada, o login chama este gancho com o e-mail de login. A #26
// (src/modules/access/) implementa a regra: compara o HMAC do e-mail com a lista de autorizados
// e define `profiles.access_status`. Até lá, o gancho não faz nada.
//
// Contrato:
// - É chamado a CADA login concluído; a implementação decide se é o primeiro e precisa ser
//   idempotente.
// - O e-mail só trafega em memória: não logar, não gravar em claro, não devolver à tela (R11).
// - Se lançar erro, o login é desfeito (a sessão é encerrada) e a pessoa vê uma mensagem
//   genérica: falha fechada.

export type FirstLoginInput = { userId: string; email: string };
export type FirstLoginHook = (input: FirstLoginInput) => Promise<void>;

/** Stub até a #26 trocar por `import { onFirstLogin } from "@/modules/access"`. */
export const onFirstLogin: FirstLoginHook = async () => {};
