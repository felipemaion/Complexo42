"use server";
// Server actions da escolha da casa (#76). O navegador manda `{ houseId, joinMethod }`,
// `{ termVersion }` ou `{ answers }`; o servidor pontua as respostas e só as guarda no pedido de
// análise do resultado inconclusivo (ADR 0014). O cliente
// do Supabase é o da sessão, com o JWT de quem está logado (R14).
import { instance } from "@config/instance";
import { encryptField, signQuestionnaireMessage } from "@/server/crypto";
import { requireUserBeforeHouse, requireUserClientBeforeHouse } from "@/server/auth/session";
import { log } from "@/server/log";
import type { HouseActionResult, SubmitAnswersResult } from "../types";
import { acceptHouse, recordConsent, submitQuestionnaire } from "./houses";
import { getQuestionnaire } from "./questionnaire";
import { sessionHouseClient } from "./session";

function logged(event: string, result: HouseActionResult): HouseActionResult {
  // Só o código do motivo: nada da pessoa nem da casa no log (R11).
  if (!result.ok) log.warn(event, { reason: result.error });
  return result;
}

export async function acceptHouseAction(input: unknown): Promise<HouseActionResult> {
  await requireUserBeforeHouse();
  const client = await sessionHouseClient();
  if (!client) return { ok: false, error: "failed" };
  const houseIds = instance.houses.map((h) => h.id);
  // A versão do termo vem do questionário carregado aqui, nunca do navegador.
  const termVersion = getQuestionnaire().consentTermVersion;
  return logged("house_accept_refused", await acceptHouse(client, input, houseIds, termVersion));
}

export async function recordConsentAction(input: unknown): Promise<HouseActionResult> {
  await requireUserBeforeHouse();
  const client = await sessionHouseClient();
  if (!client) return { ok: false, error: "failed" };
  return logged("questionnaire_consent_refused", await recordConsent(client, input, getQuestionnaire().consentTermVersion));
}

/**
 * Pontua as respostas no servidor e grava o resultado (ADR 0014 §1). O navegador manda só
 * `{ answers }`; a chave real do questionário nunca sai do servidor. Totem e respostas vão cifrados
 * ao banco (ADR 0003). As respostas não vão para o log.
 */
export async function submitAnswersAction(input: unknown): Promise<SubmitAnswersResult> {
  const { user } = await requireUserClientBeforeHouse();
  const client = await sessionHouseClient();
  if (!client) return { ok: false, error: "failed" };
  let result: SubmitAnswersResult;
  try {
    result = await submitQuestionnaire(client, input, {
      questionnaire: getQuestionnaire(),
      houseIds: instance.houses.map((h) => h.id),
      userId: user.id,
      nowSeconds: Math.floor(Date.now() / 1000),
      sign: signQuestionnaireMessage,
      encrypt: encryptField,
    });
  } catch {
    // Sem chave de assinatura (ou erro inesperado): falha fechado, sem detalhe nem respostas no log.
    result = { ok: false, error: "failed" };
  }
  if (!result.ok) log.warn("questionnaire_submit_refused", { reason: result.error });
  return result;
}
