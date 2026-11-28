// Comparação de casa na tela "Escolher outra casa" (ADR 0014). Roda só no servidor: a chave (polos por casa), as frases de
// expectativa e as notas dos membros nunca chegam ao navegador. O navegador recebe só o que se espera na casa escolhida
// (texto e intensidade) e, com membros suficientes, as médias dos eixos da casa, arredondadas (sem o número de membros). Nada
// do totem.
//
// As respostas NÃO vêm do navegador: o servidor as sela num token cifrado para a pessoa ao pontuar o questionário (elas não
// são guardadas em lugar nenhum, ADR 0014) e a comparação só abre esse token. Assim ninguém varre a chave com respostas
// fabricadas.
import "server-only";
import { z } from "zod";
import { axisExpectations, houseExpectations, type Answer, type QuestionnaireConfig } from "@/modules/questionnaire";
import type { CipherContext, HouseClient } from "../types";
import { openCompareBasis } from "./compare-token";
import { scoresContext } from "./houses";

export { openCompareToken, sealCompareToken, sealScoresToken } from "./compare-token";

/** Agregado guardado em memória por casa: só a conta e as somas (nada por pessoa). `failedAt`: falha recente (cache curto). */
export type HouseAverage = { at: number; n: number; sums: { house1: number; house2: number }; failed?: boolean };
export type AverageCache = Map<string, HouseAverage>;

/** Limite por pessoa: `allow` já conta a chamada. */
export type RateLimiter = { allow(userId: string, nowSeconds: number): boolean };

export type CompareContext = {
  questionnaire: QuestionnaireConfig;
  houseIds: readonly string[];
  /** Id da pessoa da sessão (nunca do navegador): a assinatura e o token a ligam à chamada. */
  userId: string;
  nowSeconds: number;
  sign(message: string): string;
  decrypt(value: string, context: CipherContext): Promise<string>;
  /** Membros mínimos (com notas) para mostrar a média; abaixo disso só "poucos membros". */
  minMembers: number;
  cache: AverageCache;
  cacheSeconds: number;
  /** Consultas em andamento por casa: chamadas simultâneas dividem uma só (sem avalanche). */
  inflight: Map<string, Promise<HouseAverage>>;
  /** Quanto tempo uma falha do banco fica guardada (não insiste a cada clique). */
  failureSeconds: number;
  /** Validade do token das respostas. */
  tokenSeconds: number;
  limiter: RateLimiter;
  /** Quantas linhas não decifraram (só a contagem, nunca valor nem id). */
  onSkipped?(count: number): void;
};

export type AverageView = { status: "ok"; scores: { house1: number; house2: number } } | { status: "few" } | { status: "unavailable" };

export type HouseComparison =
  | { ok: true; expectations: { text: string; answer: Answer }[]; average: AverageView }
  | { ok: false; error: "failed" | "rate_limited" | "expired" };

// ---------------------------------------------------------------------------------------
// Média
// ---------------------------------------------------------------------------------------
/** A média sai arredondada de 5 em 5 (-100..100): quem vê não reconstrói notas individuais. */
const roundStep = 5;
const roundScore = (value: number): number => Math.round(value / roundStep) * roundStep + 0;

const rowSchema = z.object({ profile_id: z.string(), scores_enc: z.string() });
// Só os eixos da casa: as notas do totem nunca são lidas.
const houseScoresSchema = z.object({ house1: z.number().min(-100).max(100), house2: z.number().min(-100).max(100) });

/** Média dos eixos da casa dos membros da casa, da função assinada. Linha ilegível é descartada e só contada. */
async function fetchAverage(client: HouseClient, houseId: string, ctx: CompareContext): Promise<HouseAverage> {
  const failed: HouseAverage = { at: ctx.nowSeconds, n: 0, sums: { house1: 0, house2: 0 }, failed: true };
  let signature: string;
  try {
    signature = ctx.sign(`house_scores|${ctx.userId}|${houseId}|${ctx.nowSeconds}`);
  } catch {
    return failed;
  }
  const { data, error } = await client.rpc("house_member_scores_enc", { p_house_key: houseId, p_issued_at: ctx.nowSeconds, p_signature: signature });
  if (error || !Array.isArray(data)) return failed;
  let n = 0;
  let skipped = 0;
  const sums = { house1: 0, house2: 0 };
  for (const raw of data) {
    const row = rowSchema.safeParse(raw);
    if (!row.success) {
      skipped += 1;
      continue;
    }
    try {
      const scores = houseScoresSchema.parse(JSON.parse(await ctx.decrypt(row.data.scores_enc, scoresContext(row.data.profile_id))));
      n += 1;
      sums.house1 += scores.house1;
      sums.house2 += scores.house2;
    } catch {
      skipped += 1;
    }
  }
  if (skipped > 0) ctx.onSkipped?.(skipped);
  return { at: ctx.nowSeconds, n, sums };
}

async function averageOf(client: HouseClient, houseId: string, ctx: CompareContext): Promise<AverageView> {
  let aggregate = ctx.cache.get(houseId);
  const ttl = aggregate?.failed ? ctx.failureSeconds : ctx.cacheSeconds;
  if (!aggregate || ctx.nowSeconds - aggregate.at >= ttl) {
    let pending = ctx.inflight.get(houseId);
    if (!pending) {
      pending = fetchAverage(client, houseId, ctx).finally(() => ctx.inflight.delete(houseId));
      ctx.inflight.set(houseId, pending);
    }
    aggregate = await pending;
    ctx.cache.set(houseId, aggregate);
  }
  if (aggregate.failed) return { status: "unavailable" };
  if (aggregate.n < ctx.minMembers) return { status: "few" };
  return { status: "ok", scores: { house1: roundScore(aggregate.sums.house1 / aggregate.n), house2: roundScore(aggregate.sums.house2 / aggregate.n) } };
}

/**
 * O que se espera na casa selecionada e a média dos membros dela, para a pessoa comparar ANTES de confirmar. As respostas vêm
 * do token que o servidor selou ao pontuar; a chave e o resto ficam no servidor.
 */
export async function compareHouse(client: HouseClient, input: unknown, ctx: CompareContext): Promise<HouseComparison> {
  const parsed = z.strictObject({ houseId: z.string().refine((id) => ctx.houseIds.includes(id)), token: z.string().max(8192) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "failed" };
  const basis = await openCompareBasis(parsed.data.token, ctx.userId, ctx.nowSeconds, ctx.tokenSeconds, ctx.decrypt);
  if (!basis) return { ok: false, error: "failed" };
  // Vencido: a tela pede para recarregar; não gasta o limite nem consulta o banco.
  if (basis.kind === "expired") return { ok: false, error: "expired" };
  if (!ctx.limiter.allow(ctx.userId, ctx.nowSeconds)) return { ok: false, error: "rate_limited" };
  // Com respostas guardadas, a expectativa é por pergunta; sem elas, a frase geral do eixo (#268).
  const found =
    basis.kind === "answers"
      ? houseExpectations(ctx.questionnaire, basis.answers, parsed.data.houseId)
      : axisExpectations(ctx.questionnaire, basis.scores, parsed.data.houseId);
  const expectations = found.map(({ text, answer }) => ({ text, answer }));
  return { ok: true, expectations, average: await averageOf(client, parsed.data.houseId, ctx) };
}
