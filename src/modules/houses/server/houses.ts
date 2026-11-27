// Escolha e aceite da casa no servidor (#76, ADR 0008 §2 e §2.1). Recebe o id da casa e a forma
// de entrada, a versão do termo, ou o resultado do questionário (casa e totem). As respostas só
// chegam no pedido de análise do resultado inconclusivo (ADR 0012).
// Toda entrada passa por Zod antes de ir ao banco, que confere de novo (R15).
import "server-only";
import { z } from "zod";
import { axisKeys } from "@/modules/questionnaire";
import type { HouseActionResult, HouseClient, HouseErrorCode } from "../types";

/** Código do Postgres/PostgREST → motivo exibido. Qualquer outro vira `failed`. */
const errorByCode: Record<string, HouseErrorCode> = {
  "42501": "not_active", // não liberado, sem perfil ou sem sessão
  P0002: "unavailable", // casa inexistente ou inativa
  "23505": "already_accepted", // outra casa já aceita
  C7602: "removed_by_coordination", // a coordenação encerrou a casa da pessoa
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

/**
 * Grava o resultado conclusivo do questionário: a casa sugerida e o totem (ADR 0012). `input`
 * vem do navegador; as respostas nunca vêm junto. A versão do termo é a do servidor.
 */
export async function recordQuestionnaireResult(
  client: HouseClient,
  input: unknown,
  houseIds: readonly string[],
  termVersion: string,
): Promise<HouseActionResult> {
  const parsed = z
    .strictObject({
      houseId: z.string().refine((id) => houseIds.includes(id)),
      totem: z.string().regex(/^[A-Z]{2}$/),
    })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "failed" };
  const { error } = await client.rpc("record_questionnaire_result", {
    p_term_version: termVersion,
    p_house_key: parsed.data.houseId,
    p_totem: parsed.data.totem,
  });
  return error ? { ok: false, error: errorCode(error) } : { ok: true };
}

/**
 * Pede a análise da coordenação nacional quando o resultado é inconclusivo (ADR 0012 §3). É o
 * único caso em que as respostas saem do aparelho: o banco as guarda só com o pedido aberto.
 * Os ids dos itens precisam ser os do questionário carregado no servidor.
 */
export async function requestHouseAnalysis(
  client: HouseClient,
  input: unknown,
  itemIds: readonly string[],
  termVersion: string,
): Promise<HouseActionResult> {
  const parsed = z
    .strictObject({
      axes: z.array(z.enum(axisKeys)).min(1).max(axisKeys.length),
      answers: z.record(z.string().refine((id) => itemIds.includes(id)), z.enum(["a", "b", "both"])),
    })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "failed" };
  const { error } = await client.rpc("request_house_analysis", {
    p_term_version: termVersion,
    p_tied_axes: parsed.data.axes,
    p_answers: parsed.data.answers,
  });
  return error ? { ok: false, error: errorCode(error) } : { ok: true };
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
