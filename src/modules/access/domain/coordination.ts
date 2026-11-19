/**
 * Telas da coordenação para a lista de autorizados e a fila de espera (ADR 0008 §1, #26).
 * Funções puras: endereços, leitura dos parâmetros da URL e dos campos do formulário, e a
 * montagem dos textos. Quem decide quem pode o quê é o banco (`app.can_*`, R15); aqui só se
 * lê o que veio na requisição.
 */
import { z } from "zod";
import type { AllowlistSource, WaitlistCursor, WaitlistDecision } from "../types";

export const COORDINATION_PATH = "/coordenacao";
export const ALLOWLIST_UPLOAD_PATH = "/coordenacao/autorizados";
export const WAITLIST_QUEUE_PATH = "/coordenacao/espera";

/** Nomes dos campos do formulário de envio da lista e da decisão. */
export const ALLOWLIST_FILE_FIELD = "arquivo";
export const ALLOWLIST_SOURCE_FIELD = "origem";
export const DECISION_PROFILE_FIELD = "pessoa";
export const DECISION_FIELD = "decisao";

/** Parâmetros da URL da fila: posição (cursor), confirmação pendente e resultado. */
export const WAITLIST_PARAMS = {
  afterDate: "apos_data",
  afterId: "apos_id",
  confirm: "confirmar",
  confirmDecision: "decisao",
  done: "feito",
} as const;

export const allowlistSources = ["academy", "form", "manual"] as const satisfies readonly AllowlistSource[];

/** Decisão como aparece na URL e no formulário (português) e como vai para o banco. */
const decisionWords = { liberar: "active", bloquear: "blocked" } as const satisfies Record<string, WaitlistDecision>;
export type DecisionWord = keyof typeof decisionWords;

export const waitlistDoneStatuses = ["liberado", "bloqueado", "indisponivel", "erro"] as const;
export type WaitlistDoneStatus = (typeof waitlistDoneStatuses)[number];

export const allowlistUploadErrors = [
  "no_file",
  "wrong_type",
  "too_large",
  "too_many",
  "empty",
  "invalid_source",
  "forbidden",
  "failed",
] as const;
export type AllowlistUploadError = (typeof allowlistUploadErrors)[number];

/** Quantos números de linha ruim a action devolve ao navegador; o resto vira só o total. */
export const invalidLinesReturnedMax = 200;

/** Estado do formulário de envio: só contagens e números de linha, nunca e-mails. */
export type AllowlistUploadState =
  | { status: "idle" }
  | {
      status: "done";
      received: number;
      promoted: number;
      /** Até `invalidLinesReturnedMax` números de linha, em ordem. */
      invalidLines: number[];
      /** Total de linhas ruins no arquivo (pode passar do que veio em `invalidLines`). */
      invalidLineCount: number;
    }
  | { status: "error"; error: AllowlistUploadError };

type Params = Record<string, string | string[] | undefined>;
const single = (value: string | string[] | undefined): string | undefined =>
  typeof value === "string" ? value : undefined;

export function parseAllowlistSource(value: unknown): AllowlistSource | null {
  return allowlistSources.find((source) => source === value) ?? null;
}

/** Só `.csv` e `.txt` (o tipo informado pelo navegador varia muito; vale a extensão). */
export function isAllowedAllowlistFileName(name: string): boolean {
  return /\.(csv|txt)$/i.test(name.trim());
}

/**
 * Data e hora que existem no calendário. O formato ISO sozinho deixa passar `2026-13-45T…` ou
 * `2026-02-30T…`, que o Postgres recusa (22008) e virariam erro na tela.
 */
function isRealDateTime(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/.exec(value);
  if (!match) return false;
  const [year, month, day, hour, minute, second] = match.slice(1).map(Number) as [number, number, number, number, number, number];
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day &&
    date.getUTCHours() === hour &&
    date.getUTCMinutes() === minute &&
    date.getUTCSeconds() === second
  );
}

const cursorSchema = z.object({
  createdAt: z.iso.datetime({ offset: true }).refine(isRealDateTime),
  profileId: z.guid(),
});

/** Posição na fila vinda da URL; qualquer coisa inválida volta ao começo da lista. */
export function parseWaitlistCursor(params: Params): WaitlistCursor | undefined {
  const parsed = cursorSchema.safeParse({
    createdAt: single(params[WAITLIST_PARAMS.afterDate]),
    profileId: single(params[WAITLIST_PARAMS.afterId]),
  });
  return parsed.success ? parsed.data : undefined;
}

/** Endereço da fila numa posição (sem cursor, o começo), com parâmetros extras opcionais. */
export function waitlistHref(cursor?: WaitlistCursor, extra: Record<string, string> = {}): string {
  const query = new URLSearchParams();
  if (cursor) {
    query.set(WAITLIST_PARAMS.afterDate, cursor.createdAt);
    query.set(WAITLIST_PARAMS.afterId, cursor.profileId);
  }
  for (const [key, value] of Object.entries(extra)) query.set(key, value);
  const text = query.toString();
  return text ? `${WAITLIST_QUEUE_PATH}?${text}` : WAITLIST_QUEUE_PATH;
}

export function parseDecisionWord(value: unknown): DecisionWord | null {
  return value === "liberar" || value === "bloquear" ? value : null;
}

export function decisionOf(word: DecisionWord): WaitlistDecision {
  return decisionWords[word];
}

/** Pedido de confirmação na URL: de quem e qual decisão. */
export function parseConfirmation(params: Params): { profileId: string; word: DecisionWord } | null {
  const profileId = z.guid().safeParse(single(params[WAITLIST_PARAMS.confirm]));
  const word = parseDecisionWord(single(params[WAITLIST_PARAMS.confirmDecision]));
  return profileId.success && word ? { profileId: profileId.data, word } : null;
}

export function parseWaitlistDone(value: unknown): WaitlistDoneStatus | null {
  return waitlistDoneStatuses.find((status) => status === value) ?? null;
}

/** Troca `{chave}` pelos valores (todas as ocorrências). */
export function fillText(template: string, values: Record<string, string | number>): string {
  return Object.entries(values).reduce((text, [key, value]) => text.replaceAll(`{${key}}`, String(value)), template);
}

/**
 * Até `max` números de linha para a tela; o resto vira só a contagem. `total` é o total de
 * linhas ruins do arquivo, que pode ser maior que a lista recebida.
 */
export function previewLines(lines: readonly number[], total: number, max = 30): { shown: number[]; hidden: number } {
  const shown = lines.slice(0, max);
  return { shown, hidden: Math.max(0, total - shown.length) };
}
