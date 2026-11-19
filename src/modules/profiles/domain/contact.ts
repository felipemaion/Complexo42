// Quem vê o contato de cada pessoa (issue #119, ADR 0010). Regras puras: os tipos de contato, as
// escolhas possíveis e a leitura do que o formulário e o banco mandam. A decisão de acesso é do
// banco (`app.can_view_contact`, R15); aqui só se valida a entrada (Zod, no servidor).
import { z } from "zod";

/** Os contatos que a pessoa controla, um por um. */
export const contactKinds = ["whatsapp", "social", "email"] as const;
export type ContactKind = (typeof contactKinds)[number];

/** Quem, além da coordenação, vê: ninguém (padrão), a equipe, ou a equipe e a casa. */
export const contactScopes = ["none", "team", "team_house"] as const;
export type ContactScope = (typeof contactScopes)[number];

/** A escolha de cada contato. O que não foi escolhido vale `none`. */
export type ContactVisibility = Record<ContactKind, ContactScope>;

export const defaultContactVisibility: ContactVisibility = { whatsapp: "none", social: "none", email: "none" };

export const contactVisibilityChoiceSchema = z.object({
  kind: z.enum(contactKinds),
  scope: z.enum(contactScopes),
});
export type ContactVisibilityChoice = z.output<typeof contactVisibilityChoiceSchema>;

/** Lê a escolha enviada pelo formulário; qualquer outro valor é recusado. */
export function parseContactVisibilityChoice(raw: unknown): ContactVisibilityChoice | null {
  const parsed = contactVisibilityChoiceSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

const visibilityRows = z.array(z.object({ kind: z.enum(contactKinds), scope: z.enum(contactScopes) }));

/** As linhas de `contact_visibility` da própria pessoa viram a escolha completa (falta = `none`). */
export function visibilityFromRows(rows: unknown): ContactVisibility {
  const result = { ...defaultContactVisibility };
  for (const row of visibilityRows.parse(rows)) result[row.kind] = row.scope;
  return result;
}

/** O que o servidor devolve ao "ver contato": só os contatos permitidos aparecem. */
export type MemberContact = {
  whatsapp?: string | null;
  social?: string[] | null;
  email?: string | null;
};

/** Um acesso ao contato da pessoa, já com o nome de quem viu decifrado (ou nulo). */
export type ContactView = { viewerName: string | null; kind: ContactKind; viewedAt: string };

/** Tela "Quem vê meu contato". */
export const CONTACT_VISIBILITY_PATH = "/perfil/contato";
/** Parâmetro da tela que diz como foi a última gravação. */
export const CONTACT_VISIBILITY_STATUS_PARAM = "escolha";
export const contactVisibilityStatuses = ["salva", "erro"] as const;
export type ContactVisibilityStatus = (typeof contactVisibilityStatuses)[number];

/** Lê o parâmetro da tela; qualquer outro valor é ignorado. */
export function parseContactVisibilityStatus(raw: unknown): ContactVisibilityStatus | null {
  return (contactVisibilityStatuses as readonly unknown[]).includes(raw) ? (raw as ContactVisibilityStatus) : null;
}

/** Textos da lista de quem viu (vêm de config/, R17). */
export type ContactViewText = {
  viewsLine: string;
  viewsKinds: Record<ContactKind, string>;
  viewsUnknownPerson: string;
};

/** "Fulana viu seu WhatsApp em 19/11/2026, 14:05", com a hora de Brasília. */
export function describeContactView(view: ContactView, text: ContactViewText): string {
  const date = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(view.viewedAt));
  return text.viewsLine
    .replace("{name}", view.viewerName ?? text.viewsUnknownPerson)
    .replace("{kind}", text.viewsKinds[view.kind])
    .replace("{date}", date);
}
