// Termo de consentimento (#11). Puro: sem banco, rede nem React.
import { z } from "zod";

/** Tela do termo (fora do grupo `(conta)`, para não passar pelo portão de consentimento). */
export const CONSENT_PATH = "/termo";
/** Valor de `profiles.consent_version` de quem nunca aceitou (#125). Nunca é uma versão de termo. */
export const NO_CONSENT_VERSION = "none";
/** Mesmo formato do CHECK de `profiles.consent_version` e de `accept_consent`. */
const consentVersionPattern = /^[A-Za-z0-9._-]{1,32}$/;

const text = z.string().trim().min(1);
// Os itens [jurídico] e [decidir] do rascunho não vão para a tela (#11): se sobrarem na config,
// o app não sobe, em vez de mostrar a pergunta do jurídico a quem usa.
const publicText = text.refine((value) => !/\[\s*(jur[ií]dico|decidir)/i.test(value), {
  message: "trecho pendente do jurídico não pode aparecer no termo",
});

const sectionSchema = z.object({
  heading: publicText,
  paragraphs: z.array(publicText).readonly().default([]),
  /** Pares "o que / por quê", mostrados como lista de definições (mais legível que tabela). */
  rows: z.array(z.object({ label: publicText, text: publicText })).readonly().default([]),
  bullets: z.array(publicText).readonly().default([]),
});

export const consentTermSchema = z.object({
  version: z.string().regex(consentVersionPattern).refine((value) => value !== NO_CONSENT_VERSION, {
    message: "'none' significa sem aceite",
  }),
  title: publicText,
  intro: publicText,
  sections: z.array(sectionSchema).min(1).readonly(),
  /** A caixa de aceite: vem desmarcada e o botão só habilita depois de marcar. */
  checkboxLabel: publicText,
  continueButton: publicText,
  uncheckedHint: publicText,
  declineButton: publicText,
  /** Nome do grupo "baixar meus dados / excluir conta", mostrado na tela do termo. */
  rightsTitle: publicText,
  errors: z.object({ unchecked: publicText, failed: publicText }),
});

export type ConsentTerm = z.infer<typeof consentTermSchema>;

/** Valida a config na carga: texto vazio, versão inválida ou trecho pendente derruba o build. */
export function parseConsentTerm(raw: unknown): ConsentTerm {
  const parsed = consentTermSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  const where = parsed.error.issues.map((issue) => issue.path.join(".") || "(raiz)").join(", ");
  throw new Error(`config/consent.ts inválido em: ${where}`);
}

/** O que o formulário manda: a caixa marcada chega como "on". Qualquer outra coisa = não aceitou. */
export const consentFormSchema = z.object({ accepted: z.literal("on") });

export type ConsentFormState = { status: "idle" } | { status: "unchecked" } | { status: "failed" };
