// A casa e o gráfico da própria pessoa na página dela (#203). Lê só o que é dela, com o JWT da
// sessão (R14): a casa aceita e o resultado do questionário. Pede ao banco apenas a casa e as notas
// cifradas, nunca o totem, e devolve só os eixos 1 e 2 (ADR 0014 §2). Nada aqui vai para log (R11).
import "server-only";
import { z } from "zod";
import { chartAxes, type ChartAxis, type HouseByPoles, type QuestionnaireConfig } from "@/modules/questionnaire";
import { homeCard } from "../domain/home-card";
import type { CipherContext, HouseClient } from "../types";
import { scoresContext, readAcceptedHouse } from "./houses";

export type OwnHouseCard =
  | { kind: "invite" }
  | { kind: "house"; houseId: string; isAccepted: boolean; chart: ChartAxis[] | null; houseByPoles: HouseByPoles };

export type OwnHouseDeps = {
  crypto: { decrypt(value: string, context: CipherContext): Promise<string> };
  questionnaire: QuestionnaireConfig;
  houseIds: readonly string[];
};

const resultRow = z.object({ house_key: z.string(), scores_enc: z.string().nullable() }).nullable();
const scoresJson = z.strictObject({
  house1: z.number().int().min(-100).max(100),
  house2: z.number().int().min(-100).max(100),
  totem1: z.number().int().min(-100).max(100),
  totem2: z.number().int().min(-100).max(100),
});

export async function readOwnHouseCard(client: HouseClient, userId: string, deps: OwnHouseDeps): Promise<OwnHouseCard> {
  const { crypto, questionnaire, houseIds } = deps;
  const acceptedHouseId = await readAcceptedHouse(client, userId, houseIds);
  const { data, error } = await client.from("questionnaire_results").select("house_key,scores_enc").eq("profile_id", userId).maybeSingle();
  if (error) throw new Error("own_result_read_failed");
  const row = resultRow.parse(data);
  const result = row && houseIds.includes(row.house_key) ? row : null;
  const card = homeCard({ acceptedHouseId, result: result && { houseId: result.house_key, hasScores: result.scores_enc !== null } });
  if (card.kind === "invite") return card;
  let chart: ChartAxis[] | null = null;
  if (card.showChart && result?.scores_enc) {
    try {
      const scores = scoresJson.parse(JSON.parse(await crypto.decrypt(result.scores_enc, scoresContext(userId))));
      chart = chartAxes(questionnaire, scores, ["house1", "house2"]);
    } catch {
      // Notas ilegíveis: a casa aparece sem o gráfico; nunca o motivo nem o valor.
      chart = null;
    }
  }
  return { kind: "house", houseId: card.houseId, isAccepted: card.isAccepted, chart, houseByPoles: questionnaire.houseByPoles };
}
