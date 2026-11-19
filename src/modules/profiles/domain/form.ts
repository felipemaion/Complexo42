import { z } from "zod";
import { profileContactInputSchema, profileInputSchema } from "./schema";
import { brazilianWhatsappToE164, whatsappInputMaxLength } from "./whatsapp";
import type { ProfileContactInput, ProfileInput } from "../types";

/**
 * O que chega do formulário do perfil (issue #12), campo a campo, como texto. Validado aqui no
 * servidor (a máscara do navegador é só conforto) e convertido nos schemas de
 * `./schema.ts`, que são o contrato do que é cifrado e gravado.
 */
export const profileFormFields = ["displayName", "whatsapp", "municipalityCode", "district"] as const;
export type ProfileFormField = (typeof profileFormFields)[number];

/** Distritos aceitos para o município (ou `undefined`: o município não tem escolha de distrito). */
export type DistrictCatalog = (municipalityCode: number) => readonly string[] | undefined;

/**
 * Versão do termo de quem ainda não aceitou. É o que `save_own_profile` grava na criação; o
 * formulário não envia versão nenhuma ao banco (só a função do aceite, #11, a avança).
 */
export const consentNotYetGiven = "none";

const field = z.string().max(200).optional();
const formSchema = z.object({
  displayName: field,
  whatsapp: field,
  municipalityCode: field,
  district: field,
});

export type ParsedProfileForm =
  | { ok: true; profile: ProfileInput; contact: ProfileContactInput }
  | { ok: false; fields: ProfileFormField[] };

/** Lê os campos de um FormData (ou objeto) sem nunca devolver o valor em erro (R11). */
export function parseProfileForm(raw: unknown, districtsFor: DistrictCatalog): ParsedProfileForm {
  const form = formSchema.safeParse(raw);
  if (!form.success) return { ok: false, fields: [...profileFormFields] };
  const { displayName, whatsapp, municipalityCode, district } = form.data;
  const invalid = new Set<ProfileFormField>();

  const code = /^\d{7}$/.test(municipalityCode?.trim() ?? "") ? Number(municipalityCode) : null;
  if (code === null) invalid.add("municipalityCode");

  // Distrito só para município com lista; fora dela, o valor enviado é descartado.
  const allowed = code === null ? undefined : districtsFor(code);
  const chosen = district?.trim() || null;
  if (allowed && chosen !== null && !allowed.includes(chosen)) invalid.add("district");

  const profile = profileInputSchema.safeParse({
    displayName: displayName ?? "",
    municipalityCode: code ?? 0,
    district: allowed ? chosen : null,
    consentVersion: consentNotYetGiven,
  });
  if (!profile.success) {
    for (const issue of profile.error.issues) {
      const name = issue.path[0];
      if (name === "displayName" || name === "district") invalid.add(name);
      else if (name === "municipalityCode") invalid.add("municipalityCode");
    }
  }

  const e164 = (whatsapp?.length ?? 0) <= whatsappInputMaxLength ? brazilianWhatsappToE164(whatsapp ?? "") : null;
  const contact = profileContactInputSchema.safeParse({ whatsapp: e164 ?? "", socialLinks: [] });
  if (!contact.success) invalid.add("whatsapp");

  if (invalid.size > 0 || !profile.success || !contact.success) {
    return { ok: false, fields: profileFormFields.filter((name) => invalid.has(name)) };
  }
  return { ok: true, profile: profile.data, contact: contact.data };
}
