/**
 * Tela de bloqueio de quem já está ativo (#26, ADR 0008 §1). Funções puras: campos do
 * formulário, leitura do pedido e estados da tela. A coordenação identifica a pessoa pelo
 * e-mail da reclamação; quem pode bloquear quem é o banco (`app.can_block_member`, R15), e a
 * resposta dele é neutra no retorno, exista ou não a conta.
 */
import type { MemberBlockAction, MemberBlockReason } from "../types";
import { normalizeAllowlistEmail } from "./allowlist-csv";

export const MEMBER_BLOCK_PATH = "/coordenacao/bloqueio";

export const MEMBER_BLOCK_FIELDS = { email: "email", action: "acao", reason: "motivo", step: "etapa" } as const;

/** Botões que enviam o formulário: preparar abre a confirmação; só confirmar chama o banco. */
export const memberBlockSteps = ["preparar", "confirmar", "cancelar"] as const;
export type MemberBlockStep = (typeof memberBlockSteps)[number];

export const memberBlockReasons = ["impersonation", "conduct", "other"] as const satisfies readonly MemberBlockReason[];

/** Ação como aparece no formulário (português) e como vai para o banco. */
const actionWords = { bloquear: "block", desbloquear: "unblock" } as const satisfies Record<string, MemberBlockAction>;
export type MemberBlockWord = keyof typeof actionWords;

export type MemberBlockRequest = {
  /** Já normalizado (minúsculas, sem espaços). */
  email: string;
  action: MemberBlockAction;
  /** Só no bloqueio, e opcional. */
  reason: MemberBlockReason | null;
};

export const memberBlockErrors = ["invalid_email", "invalid_action", "invalid_reason", "forbidden", "rate_limited", "failed"] as const;
export type MemberBlockError = (typeof memberBlockErrors)[number];

export type MemberBlockState =
  | { status: "idle" }
  | { status: "confirm"; request: MemberBlockRequest }
  | { status: "done"; action: MemberBlockAction }
  | { status: "error"; error: MemberBlockError };

type FormFields = { get(name: string): unknown };

export function wordOf(action: MemberBlockAction): MemberBlockWord {
  return action === "block" ? "bloquear" : "desbloquear";
}

/** Qual botão enviou o formulário; sem botão conhecido, preparar (nunca executa sem confirmar). */
export function parseMemberBlockStep(value: unknown): MemberBlockStep {
  return memberBlockSteps.find((step) => step === value) ?? "preparar";
}

export function parseMemberBlockRequest(
  form: FormFields,
): { ok: true; request: MemberBlockRequest } | { ok: false; error: MemberBlockError } {
  const word = form.get(MEMBER_BLOCK_FIELDS.action);
  if (word !== "bloquear" && word !== "desbloquear") return { ok: false, error: "invalid_action" };
  const rawEmail = form.get(MEMBER_BLOCK_FIELDS.email);
  const email = typeof rawEmail === "string" ? normalizeAllowlistEmail(rawEmail) : null;
  if (!email) return { ok: false, error: "invalid_email" };
  const action = actionWords[word];
  if (action === "unblock") return { ok: true, request: { email, action, reason: null } };
  const rawReason = form.get(MEMBER_BLOCK_FIELDS.reason);
  if (rawReason === null || rawReason === "") return { ok: true, request: { email, action, reason: null } };
  const reason = memberBlockReasons.find((known) => known === rawReason);
  return reason ? { ok: true, request: { email, action, reason } } : { ok: false, error: "invalid_reason" };
}
