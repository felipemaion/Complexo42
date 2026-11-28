// Tela "Trocar de casa" (#268): a mesma comparação do "Escolher outra casa" (#240), montada no SERVIDOR a partir do que está
// guardado da própria pessoa: o resultado do questionário (casa sugerida e notas, cifradas) e, se houver, as últimas respostas
// (cifradas, lidas só por função própria). O navegador não manda respostas: recebe o perfil dos eixos da casa, a casa sugerida e
// um token selado (cifrado para a pessoa, com validade) que a comparação abre no servidor. Nada do totem sai daqui.
import "server-only";
import { z } from "zod";
import { answerValues, chartAxes, type ChartAxis, type HouseByPoles, type QuestionnaireConfig } from "@/modules/questionnaire";
import type { CipherContext, HouseClient } from "../types";
import { sealCompareToken, sealScoresToken } from "./compare-token";
import { savedAnswersContext, scoresContext } from "./houses";

export type ChangeHouseContext = {
  questionnaire: QuestionnaireConfig;
  houseIds: readonly string[];
  /** Id da pessoa da sessão (nunca do navegador). */
  userId: string;
  nowSeconds: number;
  encrypt(plaintext: string, context: CipherContext): Promise<string>;
  decrypt(value: string, context: CipherContext): Promise<string>;
  /** Só o CÓDIGO do motivo quando o resultado não pôde ser lido (nunca mensagem, id nem valor): vira log no servidor. */
  onFailure?(reason: ChangeHouseFailure): void;
};

export type ChangeHouseFailure = "read_failed" | "result_unreadable";

/** Vazio quando não há resultado legível: a tela mostra só as casas, sem gráfico nem expectativas. */
export type ChangeHouseView = { suggestedId?: string; chart?: ChartAxis[]; byPoles?: HouseByPoles; compareToken?: string };

const resultRow = z.object({ house_key: z.string(), scores_enc: z.string() }).nullable();
const scoresSchema = z.object({ house1: z.number().min(-100).max(100), house2: z.number().min(-100).max(100) }).passthrough();
const answersSchema = z.record(z.string(), z.literal([...answerValues]));

/** As últimas respostas da própria pessoa, decifradas, ou null (sem guardadas, ilegíveis ou erro): nunca derruba a tela. */
async function savedAnswers(client: HouseClient, ctx: ChangeHouseContext) {
  try {
    const { data, error } = await client.rpc("own_questionnaire_answers_enc", {});
    if (error || typeof data !== "string") return null;
    return answersSchema.parse(JSON.parse(await ctx.decrypt(data, savedAnswersContext(ctx.userId))));
  } catch {
    return null;
  }
}

export async function loadChangeHouse(client: HouseClient, ctx: ChangeHouseContext): Promise<ChangeHouseView> {
  let suggestedId: string;
  let scores: z.infer<typeof scoresSchema>;
  try {
    const { data, error } = await client.from("questionnaire_results").select("house_key, scores_enc").eq("profile_id", ctx.userId).maybeSingle();
    if (error) {
      ctx.onFailure?.("read_failed");
      return {};
    }
    const row = resultRow.parse(data);
    if (!row) return {};
    if (!ctx.houseIds.includes(row.house_key)) {
      ctx.onFailure?.("result_unreadable");
      return {};
    }
    suggestedId = row.house_key;
    scores = scoresSchema.parse(JSON.parse(await ctx.decrypt(row.scores_enc, scoresContext(ctx.userId))));
  } catch {
    ctx.onFailure?.("result_unreadable");
    return {};
  }
  const answers = await savedAnswers(client, ctx);
  const compareToken = answers
    ? await sealCompareToken(answers, ctx.userId, ctx.nowSeconds, ctx.encrypt)
    : await sealScoresToken(scores, ctx.userId, ctx.nowSeconds, ctx.encrypt);
  return {
    suggestedId,
    // Só os eixos da casa (nunca o totem); o mapa das casas é o das zonas do gráfico (#201).
    chart: chartAxes(ctx.questionnaire, { ...scores, totem1: 0, totem2: 0 }, ["house1", "house2"]),
    byPoles: ctx.questionnaire.houseByPoles,
    compareToken,
  };
}
