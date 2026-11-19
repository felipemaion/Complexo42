import type { AccessStatus } from "@/modules/profiles";

/** Origem de uma entrada da lista de autorizados (`access_allowlist.source`). */
export type AllowlistSource = "form" | "academy" | "manual";

/** Decisão do gestor sobre quem está na espera. */
export type WaitlistDecision = "active" | "blocked";

/**
 * Chamada a uma função do banco (RPC do PostgREST) **com o JWT de quem está logado**, para a
 * RLS e as funções `app.can_*` valerem (R14, R15). Quem implementa é a camada de sessão (#9);
 * aqui ela é injetada para o módulo não depender do cliente do Supabase e ser testável.
 * Deve lançar quando o banco devolver erro.
 */
export type AccessRpc = (fn: string, args: Record<string, unknown>) => Promise<unknown>;

/** Resultado do primeiro login: nulo se a pessoa ainda não tem perfil (chamar de novo depois). */
export type ResolvedAccess = AccessStatus | null;

export type AllowlistImportResult = {
  /** Quantidade de e-mails distintos enviados ao banco (é o que vai para a auditoria). */
  received: number;
  /** Linhas do arquivo sem e-mail válido (só os números, nunca o conteúdo). */
  invalidLines: number[];
};

/** Item da fila de espera, com o nome já decifrado no servidor. */
export type WaitlistEntry = {
  profileId: string;
  displayName: string;
  municipalityCode: number;
  stateCode: string;
  createdAt: string;
};
