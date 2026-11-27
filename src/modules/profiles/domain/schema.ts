import { z } from "zod";
import { normalizeSocialLink, socialLinkInputMaxLength, socialLinkMaxLength } from "./social";

/**
 * Regras do texto dos dados do perfil (issue #10, docs/MODELO_DADOS.md). O banco só vê o valor
 * cifrado (`*_enc`) e não consegue conferir o conteúdo; por isso o servidor valida com estes
 * schemas ANTES de cifrar em `src/server/crypto/`. Os tetos de tamanho das colunas cifradas na
 * migration `..._profiles.sql` foram calculados a partir destes limites.
 */
export const profileLimits = {
  displayNameMin: 2,
  displayNameMax: 80,
  socialLinksMax: 5,
  socialLinkMaxLength,
} as const;

/** Espelham os CHECKs de `public.profiles` (o servidor é quem grava estes valores, não o titular). */
export const profileStatuses = ["pending", "active", "suspended"] as const;
export const accessStatuses = ["pending", "active", "waitlisted", "blocked"] as const;

/** Mesmo formato que `src/server/crypto/` exige para o HMAC do WhatsApp (ADR 0003 §3). */
const E164 = /^\+[1-9]\d{7,14}$/;
const CONTROL_CHARS = /\p{Cc}/u;

const codePoints = (value: string) => [...value].length;

/** Texto livre curto: NFC, sem caracteres de controle, espaços internos colapsados. */
function shortText(min: number, max: number) {
  return z
    .string()
    .transform((value) => value.normalize("NFC").trim().replace(/\s+/g, " "))
    .refine((value) => !CONTROL_CHARS.test(value), "caracteres de controle não são permitidos")
    .refine((value) => codePoints(value) >= min && codePoints(value) <= max, `use de ${min} a ${max} caracteres`);
}

/**
 * Um link de rede (#17): só https, sem usuário/senha, até 256 caracteres; sai normalizado (ver
 * `./social.ts`). `javascript:`, `data:`, `http:` e o que não é endereço são recusados.
 */
const httpsUrl = z
  .string()
  .max(socialLinkInputMaxLength)
  .transform((value, ctx) => {
    const href = normalizeSocialLink(value);
    if (href === null) {
      ctx.addIssue({ code: "custom", message: "use um endereço https" });
      return z.NEVER;
    }
    return href;
  });

export const profileInputSchema = z.strictObject({
  displayName: shortText(profileLimits.displayNameMin, profileLimits.displayNameMax),
  /** Código IBGE de 7 dígitos; a existência do município é conferida pela FK no banco. */
  municipalityCode: z.number().int().min(1_000_000).max(9_999_999),
  /** Código IBGE de 9 dígitos; que o distrito é do município, o banco confere. */
  districtCode: z.number().int().min(100_000_000).max(999_999_999).nullable().default(null),
  consentVersion: z.string().regex(/^[A-Za-z0-9._-]{1,32}$/, "versão do termo inválida"),
});

export const profileContactInputSchema = z.strictObject({
  /** Já em E.164 (+5511999998888). Converter o que a pessoa digitou é papel do formulário. */
  whatsapp: z.string().trim().regex(E164, "WhatsApp no formato internacional (+55...)"),
  socialLinks: z
    .array(httpsUrl)
    .max(profileLimits.socialLinksMax, `até ${profileLimits.socialLinksMax} links`)
    // Repetidos depois de normalizar (`instagram.com/a` e `https://instagram.com/a` são o mesmo).
    .refine((links) => new Set(links).size === links.length, "links repetidos")
    .default([]),
});

/** Entrada inválida: cita só os campos, nunca os valores (R11). */
export class ProfileInputError extends Error {
  constructor(readonly fields: string[]) {
    super(`Dados do perfil inválidos: ${fields.join(", ")}`);
    this.name = "ProfileInputError";
  }
}

function parseWith<T extends z.ZodType>(schema: T, raw: unknown): z.output<T> {
  const result = schema.safeParse(raw);
  if (!result.success) {
    const fields = [...new Set(result.error.issues.map((issue) => issue.path.join(".") || "(raiz)"))];
    throw new ProfileInputError(fields);
  }
  return result.data;
}

export function parseProfileInput(raw: unknown): z.output<typeof profileInputSchema> {
  return parseWith(profileInputSchema, raw);
}

export function parseProfileContactInput(raw: unknown): z.output<typeof profileContactInputSchema> {
  return parseWith(profileContactInputSchema, raw);
}

/** Texto que vai cifrado em `social_links_enc`: JSON da lista, ou `null` se não houver links. */
export function serializeSocialLinks(links: readonly string[]): string | null {
  return links.length === 0 ? null : JSON.stringify(links);
}
