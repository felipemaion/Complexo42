// Comparação de casa na tela "Escolher outra casa" (ADR 0014). Roda só no servidor: a chave (polos por casa), as frases de
// expectativa e as notas dos membros nunca chegam ao navegador. O navegador recebe só o que se espera na casa escolhida
// (texto e intensidade) e, com n suficiente, n e as médias dos eixos da casa, arredondadas. Nada do totem.
import "server-only";
import { z } from "zod";
import {
  answerValues,
  houseExpectations,
  QuestionnaireAnswerError,
  scoreQuestionnaire,
  type Answer,
  type QuestionnaireConfig,
} from "@/modules/questionnaire";
import type { CipherContext, HouseClient } from "../types";
import { scoresContext } from "./houses";

/** Agregado guardado em memória por casa: só a conta e as somas (nada por pessoa). */
export type HouseAverage = { at: number; n: number; sums: { house1: number; house2: number } };
export type AverageCache = Map<string, HouseAverage>;

export type CompareContext = {
  questionnaire: QuestionnaireConfig;
  houseIds: readonly string[];
  /** Id da pessoa da sessão (nunca do navegador): a assinatura a liga à chamada. */
  userId: string;
  nowSeconds: number;
  sign(message: string): string;
  decrypt(value: string, context: CipherContext): Promise<string>;
  /** Membros mínimos (com notas) para mostrar a média; abaixo disso só "poucos membros". */
  minMembers: number;
  cache: AverageCache;
  cacheSeconds: number;
};

export type AverageView =
  | { status: "ok"; n: number; scores: { house1: number; house2: number } }
  | { status: "few" }
  | { status: "unavailable" };

export type HouseComparison =
  | { ok: true; expectations: { text: string; answer: Answer }[]; average: AverageView }
  | { ok: false; error: "failed" };

/** A média sai arredondada de 5 em 5 (-100..100): quem vê não reconstrói notas individuais. */
const roundStep = 5;
const roundScore = (value: number): number => Math.round(value / roundStep) * roundStep + 0;

const rowSchema = z.object({ profile_id: z.string(), scores_enc: z.string() });
// Só os eixos da casa: as notas do totem nunca são lidas.
const houseScoresSchema = z.object({ house1: z.number().min(-100).max(100), house2: z.number().min(-100).max(100) });

/** Média dos eixos da casa dos membros da casa, da função assinada. Linha ilegível é descartada (e nunca entra na conta). */
async function fetchAverage(client: HouseClient, houseId: string, ctx: CompareContext): Promise<HouseAverage | null> {
  let signature: string;
  try {
    signature = ctx.sign(`house_scores|${ctx.userId}|${houseId}|${ctx.nowSeconds}`);
  } catch {
    return null;
  }
  const { data, error } = await client.rpc("house_member_scores_enc", { p_house_key: houseId, p_issued_at: ctx.nowSeconds, p_signature: signature });
  if (error || !Array.isArray(data)) return null;
  let n = 0;
  const sums = { house1: 0, house2: 0 };
  for (const raw of data) {
    const row = rowSchema.safeParse(raw);
    if (!row.success) continue;
    try {
      const scores = houseScoresSchema.parse(JSON.parse(await ctx.decrypt(row.data.scores_enc, scoresContext(row.data.profile_id))));
      n += 1;
      sums.house1 += scores.house1;
      sums.house2 += scores.house2;
    } catch {
      // Não decifra ou não tem o formato: fora da conta, sem log de valor.
    }
  }
  return { at: ctx.nowSeconds, n, sums };
}

async function averageOf(client: HouseClient, houseId: string, ctx: CompareContext): Promise<AverageView> {
  let aggregate = ctx.cache.get(houseId);
  if (!aggregate || ctx.nowSeconds - aggregate.at >= ctx.cacheSeconds) {
    const fresh = await fetchAverage(client, houseId, ctx);
    if (!fresh) return { status: "unavailable" };
    ctx.cache.set(houseId, fresh);
    aggregate = fresh;
  }
  if (aggregate.n < ctx.minMembers) return { status: "few" };
  return {
    status: "ok",
    n: aggregate.n,
    scores: { house1: roundScore(aggregate.sums.house1 / aggregate.n), house2: roundScore(aggregate.sums.house2 / aggregate.n) },
  };
}

/**
 * O que se espera na casa selecionada e a média dos membros dela, para a pessoa comparar ANTES de confirmar. As respostas
 * dela já estão no navegador (foram dela); a chave e o resto, não.
 */
export async function compareHouse(client: HouseClient, input: unknown, ctx: CompareContext): Promise<HouseComparison> {
  const parsed = z
    .strictObject({ houseId: z.string().refine((id) => ctx.houseIds.includes(id)), answers: z.record(z.string(), z.literal([...answerValues])) })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "failed" };
  try {
    scoreQuestionnaire(ctx.questionnaire, parsed.data.answers); // confere itens e valores (nada incompleto)
  } catch (error) {
    if (error instanceof QuestionnaireAnswerError) return { ok: false, error: "failed" };
    throw error;
  }
  const expectations = houseExpectations(ctx.questionnaire, parsed.data.answers, parsed.data.houseId).map(({ text, answer }) => ({ text, answer }));
  return { ok: true, expectations, average: await averageOf(client, parsed.data.houseId, ctx) };
}
