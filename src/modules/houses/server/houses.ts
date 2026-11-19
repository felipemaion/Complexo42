// Escolha e aceite da casa no servidor (#76, ADR 0008 §2 e §2.1). Recebe só o id da casa e a
// forma de entrada, ou a versão do termo: as respostas do questionário nunca chegam aqui.
// Toda entrada passa por Zod antes de ir ao banco, que confere de novo (R15).
import "server-only";
import { z } from "zod";
import { houseIdFromUnitSlug } from "../domain/link";
import type { HouseActionResult, HouseClient, HouseErrorCode } from "../types";

/** Código do Postgres/PostgREST → motivo exibido. Qualquer outro vira `failed`. */
const errorByCode: Record<string, HouseErrorCode> = {
  "42501": "not_active", // não liberado, sem perfil ou sem sessão
  P0002: "unavailable", // casa fora da região da pessoa
  "23505": "already_accepted", // outra casa já aceita
  C7601: "region_undefined", // a região da pessoa ainda não foi definida
  C7602: "removed_by_coordination", // a coordenação encerrou a casa da pessoa
};

function errorCode(error: unknown): HouseErrorCode {
  const code = typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;
  return (typeof code === "string" && errorByCode[code]) || "failed";
}

/**
 * Aceita a casa. `input` vem do navegador: só `{ houseId, joinMethod }`, e o id precisa ser de
 * uma casa da config. A versão do termo é a do questionário carregado no servidor (nunca do
 * cliente) e só vai no `questionnaire`. O banco confere quem chama, a região, o aceite dessa
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

const acceptedRow = z.object({ units: z.object({ slug: z.string() }) }).nullable();

/** A casa aceita de quem está logado (id da config), ou null. Lê só o próprio vínculo. */
export async function readAcceptedHouse(client: HouseClient, userId: string, houseIds: readonly string[]): Promise<string | null> {
  const { data, error } = await client
    .from("unit_members")
    .select("units!inner(slug)")
    .eq("profile_id", userId)
    .eq("axis", "house")
    .is("left_at", null)
    .not("accepted_at", "is", null)
    .maybeSingle();
  if (error) throw new Error(`house_read_failed:${errorCode(error)}`);
  const row = acceptedRow.parse(data);
  return row ? houseIdFromUnitSlug(row.units.slug, houseIds) : null;
}
