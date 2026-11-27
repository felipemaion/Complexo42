import type { HouseErrorCode } from "../types";

/*
 * Recusa do envio do questionário mostrada na tela (#199). Pura: só monta o texto a partir da config.
 * `retryAfterSeconds` só existe no limite de renovação do pedido de análise (ADR 0014 §3).
 */

export type Refusal = { error: HouseErrorCode; retryAfterSeconds?: number };

/** Os textos da config (`houseSelection`) que a recusa usa. */
export type RefusalTexts = {
  errors: Readonly<Record<HouseErrorCode, string>>;
  /** Limite com o tempo conhecido; `{minutes}` é trocado pelos minutos que faltam. */
  rateLimitedWait: string;
};

const secondsPerMinute = 60;

/** O texto da recusa; no limite com tempo restante, com os minutos (arredondados para cima, no mínimo 1). */
export function refusalMessage(texts: RefusalTexts, refusal: Refusal): string {
  const { error, retryAfterSeconds } = refusal;
  if (error !== "rate_limited" || retryAfterSeconds === undefined || retryAfterSeconds <= 0) return texts.errors[error];
  const minutes = Math.max(1, Math.ceil(retryAfterSeconds / secondsPerMinute));
  return texts.rateLimitedWait.replaceAll("{minutes}", String(minutes));
}
