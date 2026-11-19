// Gravação e leitura do próprio perfil no servidor (issue #12, ADR 0003). Nome e WhatsApp só
// existem em texto aqui, em memória: são validados (Zod), cifrados em src/server/crypto (AAD com
// o id real da linha, que é o id da pessoa) e o HMAC do WhatsApp é calculado aqui. O banco
// recebe só valores cifrados, pela função `save_own_profile`, com o JWT da pessoa (R14).
// Nada deste arquivo loga texto da pessoa: só códigos (R11).
import "server-only";
import { z } from "zod";
import { decryptField, encryptField, whatsappBlindIndex } from "@/server/crypto";
import { log as appLog, type Logger } from "@/server/log";
import { parseProfileForm, type DistrictCatalog } from "../domain/form";
import type { MunicipalityOption, OwnProfile, ProfileDbClient, SaveProfileResult } from "../types";

export type ProfileDeps = {
  encrypt: typeof encryptField;
  decrypt: typeof decryptField;
  blindIndex: typeof whatsappBlindIndex;
  log: Logger;
};

const defaultDeps: ProfileDeps = {
  encrypt: encryptField,
  decrypt: decryptField,
  blindIndex: whatsappBlindIndex,
  log: appLog,
};

const uuid = z.guid();
/** O que `save_own_profile` devolve quando não dá erro (#127: o repetido é retorno, não erro). */
const saveOutcome = z.enum(["saved", "duplicate_whatsapp"]);

/** Só o código do erro (Postgres/PostgREST), nunca a mensagem: ela pode trazer valores. */
function errorCode(error: unknown): string {
  const code = typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;
  return typeof code === "string" ? code.slice(0, 16) : "unknown";
}

/**
 * Valida o formulário, cifra e grava o perfil e o contato de `userId` (quem está logado; o banco
 * confere de novo com `auth.uid()`). WhatsApp de outro cadastro volta como `duplicate_whatsapp`,
 * sem dizer de quem é. Depois de 5 desses na hora, o banco recusa tudo (`PT429`) e a resposta é
 * `too_many_attempts`, igual para número livre ou já usado (#127).
 */
export async function saveOwnProfile(
  client: ProfileDbClient,
  userId: string,
  raw: unknown,
  districtsFor: DistrictCatalog,
  deps: ProfileDeps = defaultDeps,
): Promise<SaveProfileResult> {
  const rowId = uuid.parse(userId);
  const parsed = parseProfileForm(raw, districtsFor);
  if (!parsed.ok) return { status: "invalid", fields: parsed.fields };
  const { profile, contact } = parsed;

  let args: Record<string, unknown>;
  try {
    args = {
      p_display_name_enc: await deps.encrypt(profile.displayName, { table: "profiles", column: "display_name_enc", rowId }),
      p_municipality_code: profile.municipalityCode,
      p_district: profile.district,
      // Sem versão do termo: o banco grava `none` e só o aceite (#11) a avança (revisão do #125).
      p_whatsapp_enc: await deps.encrypt(contact.whatsapp, { table: "profile_contacts", column: "whatsapp_enc", rowId }),
      p_whatsapp_hmac: await deps.blindIndex(contact.whatsapp),
      // Redes sociais entram com a #17; até lá, sem links.
      p_social_links_enc: null,
    };
  } catch (error) {
    deps.log.error("profile_encrypt_failed", { reason: errorCode(error) });
    return { status: "failed" };
  }

  const { data, error } = await client.rpc("save_own_profile", args);
  if (!error) {
    const outcome = saveOutcome.safeParse(data);
    if (outcome.success) return { status: outcome.data };
    deps.log.error("profile_save_failed", { reason: "unexpected_result" });
    return { status: "failed" };
  }
  const code = errorCode(error);
  if (code === "PT429") {
    deps.log.warn("profile_save_rate_limited", { reason: code });
    return { status: "too_many_attempts" };
  }
  // Município que não existe na tabela (o trigger da UF recusa).
  if (code === "23503") return { status: "invalid", fields: ["municipalityCode"] };
  if (code === "42501") {
    deps.log.warn("profile_save_denied", { reason: code });
    return { status: "forbidden" };
  }
  deps.log.error("profile_save_failed", { reason: code });
  return { status: "failed" };
}

const ownRow = z
  .object({
    display_name_enc: z.string(),
    municipality_code: z.number().int(),
    district: z.string().nullable(),
    profile_contacts: z.object({ whatsapp_enc: z.string() }).nullable(),
  })
  .nullable();

/**
 * O próprio perfil decifrado, para preencher o formulário, ou `null` se ainda não existe. Um
 * valor que não decifra (gravado fora do servidor) vira campo vazio: a pessoa preenche de novo.
 */
export async function loadOwnProfile(
  client: ProfileDbClient,
  userId: string,
  deps: ProfileDeps = defaultDeps,
): Promise<OwnProfile | null> {
  const rowId = uuid.parse(userId);
  const { data, error } = await client
    .from("profiles")
    .select("display_name_enc, municipality_code, district, profile_contacts(whatsapp_enc)")
    .eq("id", rowId)
    .maybeSingle();
  if (error) throw new Error(`profile_read_failed:${errorCode(error)}`);
  const row = ownRow.parse(data);
  if (!row) return null;
  const open = async (value: string | undefined, table: string, column: string) => {
    if (value === undefined) return "";
    try {
      return await deps.decrypt(value, { table, column, rowId });
    } catch (err) {
      deps.log.warn("profile_decrypt_failed", { column, reason: errorCode(err) });
      return "";
    }
  };
  return {
    displayName: await open(row.display_name_enc, "profiles", "display_name_enc"),
    whatsapp: await open(row.profile_contacts?.whatsapp_enc, "profile_contacts", "whatsapp_enc"),
    municipalityCode: row.municipality_code,
    district: row.district,
  };
}

/** A pessoa já tem perfil? (Sem perfil, a página inicial manda para o formulário.) */
export async function hasOwnProfile(client: ProfileDbClient, userId: string): Promise<boolean> {
  const { data, error } = await client.from("profiles").select("id").eq("id", uuid.parse(userId)).maybeSingle();
  if (error) throw new Error(`profile_read_failed:${errorCode(error)}`);
  return data !== null;
}

const municipalityRows = z.array(z.object({ code: z.number().int(), name: z.string() }));

/** Municípios para a lista de escolha, em ordem alfabética. */
export async function listMunicipalities(client: ProfileDbClient): Promise<MunicipalityOption[]> {
  const { data, error } = await client.from("municipalities").select("code, name").order("name");
  if (error) throw new Error(`municipalities_read_failed:${errorCode(error)}`);
  return municipalityRows.parse(data).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}
