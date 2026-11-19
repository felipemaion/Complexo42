"use server";
// Server actions da escolha da casa (#76). O navegador manda só `{ houseId, joinMethod }` ou
// `{ termVersion }`; as respostas do questionário ficam no aparelho (ADR 0008 §2.1). O cliente
// do Supabase é o da sessão, com o JWT de quem está logado (R14).
import { instance } from "@config/instance";
import { requireUser } from "@/server/auth/session";
import { log } from "@/server/log";
import type { HouseActionResult } from "../types";
import { acceptHouse, recordConsent } from "./houses";
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
  return logged("house_accept_refused", await acceptHouse(client, input, houseIds));
}

export async function recordConsentAction(input: unknown): Promise<HouseActionResult> {
  await requireUser();
  const client = await sessionHouseClient();
  if (!client) return { ok: false, error: "failed" };
  return logged("questionnaire_consent_refused", await recordConsent(client, input, getQuestionnaire().consentTermVersion));
}
