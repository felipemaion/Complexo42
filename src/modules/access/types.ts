import type { AccessStatus } from "@/modules/profiles";
import type { AuthClient } from "@/server/auth/client";

/** Origem de uma entrada da lista de autorizados (`access_allowlist.source`). */
export type AllowlistSource = "form" | "academy" | "manual";

/** Decisão do gestor sobre quem está na espera. */
export type WaitlistDecision = "active" | "blocked";

/** Bloquear quem está ativo ou desbloquear quem está bloqueado (#26). */
export type MemberBlockAction = "block" | "unblock";

/** Motivo opcional do bloqueio: lista fechada, nunca texto livre (sem dado pessoal). */
export type MemberBlockReason = "impersonation" | "conduct" | "other";

/** Usuário da sessão como `auth.getUser()` devolve (só os campos usados aqui). */
export type SessionUser = { email?: string | null; email_confirmed_at?: string | null };

/**
 * O subconjunto do cliente do Supabase que este módulo usa: **o cliente do servidor com o JWT
 * de quem está logado** (R14), para a RLS e as funções `app.can_*` valerem (R15). Quem cria é
 * a camada de sessão (#9); aqui ele é injetado para o módulo não depender do pacote do
 * Supabase e ser testável. Nunca um cliente com `service_role`.
 */
export type AccessClient = {
  auth: { getUser(): PromiseLike<{ data: { user: SessionUser | null }; error: unknown }> };
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
};

export type AccessErrorCode = "no_session" | "email_not_confirmed" | "forbidden" | "db_error";

/** Erro do serviço de acesso. Mensagem fixa: nunca traz e-mail nem o texto do banco (R11). */
export class AccessError extends Error {
  constructor(readonly code: AccessErrorCode) {
    super(
      {
        no_session: "Sessão ausente ou expirada.",
        email_not_confirmed: "Confirme o e-mail antes de entrar.",
        forbidden: "O banco negou a operação para quem está logado.",
        db_error: "O banco recusou a operação.",
      }[code],
    );
    this.name = "AccessError";
  }
}

/** Resultado do primeiro login: nulo se a pessoa ainda não tem perfil (chamar de novo depois). */
export type ResolvedAccess = AccessStatus | null;

export type AllowlistImportResult = {
  /** Quantidade de e-mails distintos enviados ao banco (é o que vai para a auditoria). */
  received: number;
  /** Quantas pessoas da espera a importação liberou (o HMAC guardado no login estava nela). */
  promoted: number;
  /** Linhas do arquivo sem e-mail válido (só os números, nunca o conteúdo). */
  invalidLines: number[];
};

/** Item da fila de espera, com o nome já decifrado no servidor. */
export type WaitlistEntry = {
  profileId: string;
  /** Null quando o nome não decifra (a pessoa continua na fila). */
  displayName: string | null;
  municipalityCode: number;
  stateCode: string;
  createdAt: string;
};

/** Posição na fila: o último item da página anterior. */
export type WaitlistCursor = { createdAt: string; profileId: string };

export type WaitlistPage = { entries: WaitlistEntry[]; nextCursor: WaitlistCursor | null };

/**
 * O cliente do Supabase das leituras de apoio da coordenação: o mesmo cliente com o JWT de
 * quem está logado (R14), como em `ProfileDbClient`.
 */
export type CoordinationClient = Pick<AuthClient, "from">;

/** Atalhos da coordenação a mostrar (só conforto: quem decide é o banco, R15). */
export type CoordinationMenu = { waitlist: boolean; allowlist: boolean };
