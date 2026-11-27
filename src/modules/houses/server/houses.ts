// Escolha e aceite da casa no servidor (#76, ADR 0008 §2 e §2.1). Recebe o id da casa e a forma
// de entrada, a versão do termo, ou as respostas do questionário, que o servidor pontua (ADR 0014).
// As respostas só são guardadas no pedido de análise do resultado inconclusivo.
// Toda entrada passa por Zod antes de ir ao banco, que confere de novo (R15).
import "server-only";
import { z } from "zod";
import { answerValues, chartAxes, QuestionnaireAnswerError, scoreQuestionnaire, type QuestionnaireConfig, type QuestionnaireResult } from "@/modules/questionnaire";
import type { CipherContext, HouseActionResult, HouseClient, HouseErrorCode, SubmitAnswersResult } from "../types";

/** Código do Postgres/PostgREST → motivo exibido. Qualquer outro vira `failed`. */
const errorByCode: Record<string, HouseErrorCode> = {
  "42501": "not_active", // não liberado, sem perfil ou sem sessão
  P0002: "unavailable", // casa inexistente ou inativa
  "23505": "already_accepted", // outra casa já aceita
  C7602: "removed_by_coordination", // a coordenação encerrou a casa da pessoa
  "54000": "rate_limited", // pedido de análise renovado há pouco
};

function errorCode(error: unknown): HouseErrorCode {
  const code = typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;
  return (typeof code === "string" && errorByCode[code]) || "failed";
}

/**
 * Aceita a casa. `input` vem do navegador: só `{ houseId, joinMethod }`, e o id precisa ser de
 * uma casa da config. A versão do termo é a do questionário carregado no servidor (nunca do
 * cliente) e só vai no `questionnaire`. O banco confere quem chama, a casa, o aceite dessa
 * versão do termo e se a coordenação tirou a pessoa de uma casa (`accept_house`).
 */
export async function acceptHouse(
  client: HouseClient,
  input: unknown,
  houseIds: readonly string[],
  termVersion: string,
): Promise<HouseActionResult> {
  const parsed = z
    .strictObject({
      houseId: z.string().refine((id) => houseIds.includes(id)),
      joinMethod: z.enum(["self", "questionnaire"]),
    })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "failed" };
  const { error } = await client.rpc("accept_house", {
    p_house_key: parsed.data.houseId,
    p_join_method: parsed.data.joinMethod,
    p_term_version: parsed.data.joinMethod === "questionnaire" ? termVersion : null,
  });
  return error ? { ok: false, error: errorCode(error) } : { ok: true };
}

/**
 * Registra o aceite do termo do questionário. A versão que a pessoa leu precisa ser a do
 * questionário carregado no servidor; se o arquivo mudou no meio, ela recarrega a página.
 */
export async function recordConsent(client: HouseClient, input: unknown, currentVersion: string): Promise<HouseActionResult> {
  const parsed = z.strictObject({ termVersion: z.string().max(32) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "failed" };
  if (parsed.data.termVersion !== currentVersion) return { ok: false, error: "stale_consent" };
  const { error } = await client.rpc("record_questionnaire_consent", { p_term_version: currentVersion });
  return error ? { ok: false, error: errorCode(error) } : { ok: true };
}

/** Onde o totem e as respostas moram (viram o AAD da cifragem, ADR 0003 §3): a linha é a da pessoa. */
export const totemContext = (profileId: string): CipherContext => ({ table: "questionnaire_results", column: "totem_enc", rowId: profileId });
export const scoresContext = (profileId: string): CipherContext => ({ table: "questionnaire_results", column: "scores_enc", rowId: profileId });
export const answersContext = (profileId: string): CipherContext => ({ table: "house_analysis_requests", column: "answers_enc", rowId: profileId });

/** O que o envio das respostas precisa do servidor: o questionário real, a pessoa da sessão e a assinatura. */
export type SubmitContext = {
  questionnaire: QuestionnaireConfig;
  houseIds: readonly string[];
  /** Id da pessoa da sessão (nunca vem do navegador): o banco confere com `auth.uid()`. */
  userId: string;
  /** Segundos desde 1970 (injetado para o teste). */
  nowSeconds: number;
  sign(message: string): string;
  /** Cifra o valor com o esquema do ADR 0003 (AES-256-GCM; o contexto vira o AAD). */
  encrypt(plaintext: string, context: CipherContext): Promise<string>;
};

/**
 * Pontua as respostas NO SERVIDOR e grava o resultado (ADR 0014 §1). O navegador manda só as
 * respostas; nunca casa, totem, versão do termo nem id. O resultado vai ao banco assinado, e o
 * banco só o aceita para a pessoa da sessão: pela API direta, o navegador não impõe resultado.
 * As respostas só são guardadas no resultado inconclusivo (pedido de análise). Totem, notas e respostas
 * vão CIFRADOS (ADR 0003; AAD tabela.coluna.id-da-pessoa) e a assinatura cobre o valor cifrado.
 */
export async function submitQuestionnaire(client: HouseClient, input: unknown, ctx: SubmitContext): Promise<SubmitAnswersResult> {
  const parsed = z.strictObject({ answers: z.record(z.string(), z.literal([...answerValues])) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "failed" };
  let result: QuestionnaireResult;
  try {
    result = scoreQuestionnaire(ctx.questionnaire, parsed.data.answers);
  } catch (error) {
    if (error instanceof QuestionnaireAnswerError) return { ok: false, error: "failed" };
    throw error;
  }
  const { userId, nowSeconds, questionnaire: { consentTermVersion: term } } = ctx;
  if (result.status === "ok") {
    if (!ctx.houseIds.includes(result.houseId)) return { ok: false, error: "failed" };
    const totemEnc = await ctx.encrypt(result.totem, totemContext(userId));
    const scoresEnc = await ctx.encrypt(JSON.stringify(result.scores), scoresContext(userId));
    const signature = ctx.sign(`result|${userId}|${term}|${result.houseId}|${totemEnc}|${scoresEnc}|${nowSeconds}`);
    const { error } = await client.rpc("record_questionnaire_result", {
      p_term_version: term,
      p_house_key: result.houseId,
      p_totem_enc: totemEnc,
      p_scores_enc: scoresEnc,
      p_issued_at: nowSeconds,
      p_signature: signature,
    });
    if (error) return { ok: false, error: errorCode(error) };
    // A pessoa vê só o perfil dos eixos da casa; o totem e as notas dos outros eixos ficam internos.
    return {
      ok: true,
      outcome: "recorded",
      houseId: result.houseId,
      chart: chartAxes(ctx.questionnaire, result.scores, ["house1", "house2"]),
      // O mapa das casas só vai depois das respostas, para as zonas do gráfico (#201); a chave dos itens segue no servidor.
      houseByPoles: ctx.questionnaire.houseByPoles,
    };
  }
  const answersEnc = await ctx.encrypt(JSON.stringify(parsed.data.answers), answersContext(userId));
  const signature = ctx.sign(`analysis|${userId}|${term}|${result.axes.join(",")}|${answersEnc}|${nowSeconds}`);
  const { error } = await client.rpc("request_house_analysis", {
    p_term_version: term,
    p_tied_axes: result.axes,
    p_answers_enc: answersEnc,
    p_issued_at: nowSeconds,
    p_signature: signature,
  });
  return error ? { ok: false, error: errorCode(error) } : { ok: true, outcome: "analysis" };
}

const acceptedRow = z.object({ house_key: z.string() }).nullable();

/**
 * A casa aceita de quem está logado (id da config), ou null. Lê só o próprio vínculo de casa
 * (`house_members`, ADR 0011): a chave da casa no banco é o id da config.
 */
export async function readAcceptedHouse(client: HouseClient, userId: string, houseIds: readonly string[]): Promise<string | null> {
  const { data, error } = await client
    .from("house_members")
    .select("house_key")
    .eq("profile_id", userId)
    .is("left_at", null)
    .not("accepted_at", "is", null)
    .maybeSingle();
  if (error) throw new Error(`house_read_failed:${errorCode(error)}`);
  const row = acceptedRow.parse(data);
  return row && houseIds.includes(row.house_key) ? row.house_key : null;
}
