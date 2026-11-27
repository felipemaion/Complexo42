"use server";
// Server actions da escolha da casa (#76). O navegador manda `{ houseId, joinMethod }`,
// `{ termVersion }` ou o resultado (`{ houseId, totem }`); as respostas do questionário ficam no
// aparelho, salvo no pedido de análise do resultado inconclusivo (ADR 0014). O cliente
// do Supabase é o da sessão, com o JWT de quem está logado (R14).
import { instance } from "@config/instance";
import { requireUser } from "@/server/auth/session";
import { log } from "@/server/log";
import type { HouseActionResult } from "../types";
import { acceptHouse, recordConsent, recordQuestionnaireResult, requestHouseAnalysis } from "./houses";
import { getQuestionnaire } from "./questionnaire";
import { sessionHouseClient } from "./session";

function logged(event: string, result: HouseActionResult): HouseActionResult {
  // Só o código do motivo: nada da pessoa nem da casa no log (R11).
  if (!result.ok) log.warn(event, { reason: result.error });
  return result;
}

export async function acceptHouseAction(input: unknown): Promise<HouseActionResult> {
  await requireUser();
  const client = await sessionHouseClient();
  if (!client) return { ok: false, error: "failed" };
  const houseIds = instance.houses.map((h) => h.id);
  // A versão do termo vem do questionário carregado aqui, nunca do navegador.
  const termVersion = getQuestionnaire().consentTermVersion;
  return logged("house_accept_refused", await acceptHouse(client, input, houseIds, termVersion));
}

export async function recordConsentAction(input: unknown): Promise<HouseActionResult> {
  await requireUser();
  const client = await sessionHouseClient();
  if (!client) return { ok: false, error: "failed" };
  return logged("questionnaire_consent_refused", await recordConsent(client, input, getQuestionnaire().consentTermVersion));
}

export async function recordResultAction(input: unknown): Promise<HouseActionResult> {
  await requireUser();
  const client = await sessionHouseClient();
  if (!client) return { ok: false, error: "failed" };
  const questionnaire = getQuestionnaire();
  const houseIds = instance.houses.map((h) => h.id);
  return logged("questionnaire_result_refused", await recordQuestionnaireResult(client, input, houseIds, questionnaire.consentTermVersion));
}

export async function requestAnalysisAction(input: unknown): Promise<HouseActionResult> {
  await requireUser();
  const client = await sessionHouseClient();
  if (!client) return { ok: false, error: "failed" };
  const questionnaire = getQuestionnaire();
  const itemIds = questionnaire.items.map((item) => item.id);
  return logged("house_analysis_refused", await requestHouseAnalysis(client, input, itemIds, questionnaire.consentTermVersion));
}
