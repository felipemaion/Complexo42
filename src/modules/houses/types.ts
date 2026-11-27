import type { ChartAxis, HouseByPoles } from "@/modules/questionnaire";
export type { FlowContext, FlowEvent, FlowState, JoinMethod, Step } from "./domain/flow";

/** Onde o valor cifrado mora (AAD da decifragem, ADR 0003 §3). */
export type CipherContext = { table: string; column: string; rowId: string };

/** Motivo de recusa mostrado na tela (texto em `houseSelection.errors` da config). */
export type HouseErrorCode =
  | "unavailable"
  | "already_accepted"
  | "not_active"
  | "stale_consent"
  | "removed_by_coordination"
  | "house_locked"
  | "house_conflict"
  | "rate_limited"
  | "failed";

export type HouseActionResult = { ok: true } | { ok: false; error: HouseErrorCode };

/**
 * Resposta ao envio das respostas do questionário (ADR 0014): a casa sugerida e o perfil dos eixos
 * da casa (nunca o totem nem as notas dos outros eixos).
 */
export type SubmitAnswersResult =
  | { ok: true; outcome: "recorded"; houseId: string; chart: ChartAxis[]; byPoles: HouseByPoles }
  /** `retryAfterSeconds`: só no limite de renovação do pedido de análise, quando o tempo restante é conhecido. */
  | { ok: false; error: HouseErrorCode; retryAfterSeconds?: number };

/**
 * O subconjunto do cliente do Supabase que este módulo usa: **o cliente do servidor com o JWT
 * de quem está logado** (R14), para a RLS e as funções do banco valerem. Nunca `service_role`.
 */
export type HouseQuery = PromiseLike<{ data: unknown; error: unknown }> & {
  eq(column: string, value: string): HouseQuery;
  is(column: string, value: null): HouseQuery;
  not(column: string, operator: string, value: null): HouseQuery;
  neq(column: string, value: string): HouseQuery;
  in(column: string, values: readonly string[]): HouseQuery;
  order(column: string, options: { ascending: boolean }): HouseQuery;
  limit(count: number): HouseQuery;
  maybeSingle(): PromiseLike<{ data: unknown; error: unknown }>;
};

export type HouseClient = {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
  from(table: string): { select(columns: string): HouseQuery };
};
