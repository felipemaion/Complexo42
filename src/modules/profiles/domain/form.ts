import { z } from "zod";
import { profileContactInputSchema, profileInputSchema, profileLimits } from "./schema";
import { normalizeSocialLink, socialLinkInputMaxLength } from "./social";
import { brazilianWhatsappToE164, whatsappInputMaxLength } from "./whatsapp";
import type { ProfileContactInput, ProfileInput } from "../types";

/**
 * O que chega do formulário do perfil (issue #12), campo a campo, como texto. Validado aqui no
 * servidor (a máscara do navegador é só conforto) e convertido nos schemas de
 * `./schema.ts`, que são o contrato do que é cifrado e gravado.
 */
export const profileFormFields = ["displayName", "whatsapp", "municipalityCode", "district", "neighborhood", "socialLinks"] as const;
export type ProfileFormField = (typeof profileFormFields)[number];

/**
 * Versão do termo de quem ainda não aceitou. É o que `save_own_profile` grava na criação; o
 * formulário não envia versão nenhuma ao banco (só a função do aceite, #11, a avança).
 */
export const consentNotYetGiven = "none";

/**
 * Mais caixas de link do que isto num envio não vem do formulário (ele mostra no máximo 5):
 * o envio inteiro é recusado.
 */
export const socialLinkFormEntriesMax = 20;

/**
 * Campo escondido que o formulário sempre envia junto das caixas de link. Sem ele, o envio não
 * trouxe os links (formulário antigo, outra tela): os guardados ficam como estão (#17).
 */
export const socialLinksSentField = "socialLinksSent";

/**
 * Campo escondido que o formulário envia junto do bairro quando a caixa está à vista. Sem ele, o
 * envio não trouxe o bairro (formulário antigo, ou o valor guardado não abriu e a caixa ficou
 * escondida): o cifrado guardado é mantido, em vez de apagado (mesma ideia dos links, #17).
 */
export const neighborhoodSentField = "neighborhoodSent";

const field = z.string().max(200).optional();
const formSchema = z.object({
  displayName: field,
  whatsapp: field,
  municipalityCode: field,
  district: field,
  neighborhood: field,
  /**
   * As caixas de link, na ordem da tela (vazias são ignoradas). `undefined` = o envio não trouxe
   * os links (não veio do formulário atual): o servidor mantém os que já estão guardados.
   */
  socialLinks: z.array(z.string().max(socialLinkInputMaxLength + 1)).max(socialLinkFormEntriesMax).optional(),
});

export type ParsedProfileForm =
  | {
      ok: true;
      profile: ProfileInput;
      contact: ProfileContactInput;
      /** O envio não trouxe os links: manter os guardados em vez de apagar (comentário da #17). */
      keepSocialLinks: boolean;
      /** O envio não trouxe o bairro: manter o cifrado guardado. */
      keepNeighborhood: boolean;
    }
  | {
      ok: false;
      fields: ProfileFormField[];
      /** Posições (na ordem enviada) das caixas de link com problema, para marcar só elas. */
      badLinks?: number[];
    };

/** Confere as caixas de link: posições recusadas (inválidas ou repetidas) e os links normalizados. */
function checkSocialLinks(entries: readonly string[]): { links: string[]; bad: number[]; tooMany: boolean } {
  const links: string[] = [];
  const bad: number[] = [];
  entries.forEach((entry, index) => {
    if (entry.trim() === "") return;
    const href = normalizeSocialLink(entry);
    if (href === null || links.includes(href)) bad.push(index);
    else links.push(href);
  });
  const filled = entries.filter((entry) => entry.trim() !== "").length;
  return { links, bad, tooMany: filled > profileLimits.socialLinksMax };
}

/** Lê os campos de um FormData (ou objeto) sem nunca devolver o valor em erro (R11). */
export function parseProfileForm(raw: unknown): ParsedProfileForm {
  const form = formSchema.safeParse(raw);
  if (!form.success) return { ok: false, fields: [...profileFormFields] };
  const { displayName, whatsapp, municipalityCode, district, neighborhood, socialLinks } = form.data;
  const invalid = new Set<ProfileFormField>();

  const code = /^\d{7}$/.test(municipalityCode?.trim() ?? "") ? Number(municipalityCode) : null;
  if (code === null) invalid.add("municipalityCode");

  // Aqui só o formato do código do distrito. Que ele é do município (e que município de um
  // distrito só o descarta), quem decide é `save_own_profile`: o catálogo mora no banco.
  const chosen = district?.trim() || null;
  if (chosen !== null && !/^\d{9}$/.test(chosen)) invalid.add("district");

  const profile = profileInputSchema.safeParse({
    displayName: displayName ?? "",
    municipalityCode: code ?? 0,
    districtCode: chosen === null ? null : Number(chosen),
    neighborhood: neighborhood?.trim() || null,
    consentVersion: consentNotYetGiven,
  });
  if (!profile.success) {
    for (const issue of profile.error.issues) {
      const name = issue.path[0];
      if (name === "displayName" || name === "municipalityCode" || name === "neighborhood") invalid.add(name);
      else if (name === "districtCode") invalid.add("district");
    }
  }

  const e164 = (whatsapp?.length ?? 0) <= whatsappInputMaxLength ? brazilianWhatsappToE164(whatsapp ?? "") : null;
  const social = checkSocialLinks(socialLinks ?? []);
  if (social.bad.length > 0 || social.tooMany) invalid.add("socialLinks");

  const contact = profileContactInputSchema.safeParse({ whatsapp: e164 ?? "", socialLinks: social.links });
  if (!contact.success) {
    for (const issue of contact.error.issues) invalid.add(issue.path[0] === "socialLinks" ? "socialLinks" : "whatsapp");
  }

  if (invalid.size > 0 || !profile.success || !contact.success) {
    const fields = profileFormFields.filter((name) => invalid.has(name));
    return social.bad.length > 0 ? { ok: false, fields, badLinks: social.bad } : { ok: false, fields };
  }
  return { ok: true, profile: profile.data, contact: contact.data, keepSocialLinks: socialLinks === undefined, keepNeighborhood: neighborhood === undefined };
}
