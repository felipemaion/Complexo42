// Quem vê o contato de cada pessoa (issue #119, ADR 0010). Regras puras: os tipos de contato, as
// escolhas possíveis e a leitura do que o formulário e o banco mandam. A decisão de acesso é do
// banco (`app.can_view_contact`, R15); aqui só se valida a entrada (Zod, no servidor).
import { z } from "zod";
import { formatBrazilianWhatsapp, whatsappLink } from "./whatsapp";

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

/** Quais contatos de um alvo quem olha pode ver (só permissão, sem valor; vem de `contact_access`). */
export type ContactAccess = Record<ContactKind, boolean>;

/**
 * Resultado do clique em "ver contato", já pronto para a tela (o valor foi decifrado no servidor). `forbidden` é o
 * mesmo texto para qualquer motivo: a permissão pode ter mudado entre a tela e o clique.
 */
export type ViewContactState =
  | { status: "idle" }
  | { status: "forbidden" | "rate_limited" | "failed"; kind: ContactKind }
  | {
      status: "ok";
      kind: ContactKind;
      /** Nada cadastrado para esse tipo. */
      empty: boolean;
      whatsapp?: { display: string; href: string | null };
      social?: string[];
      email?: { address: string; href: string | null };
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

const emailShape = /^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,255}\.[A-Za-z]{2,24}$/;

/**
 * Transforma o contato devolvido pelo banco (já decifrado) no que a tela mostra. O link do WhatsApp é `wa.me` só com
 * dígitos validados; o do e-mail só se o endereço tem a forma de e-mail. Qualquer coisa fora disso aparece como texto,
 * sem link. Sem valor: `empty`.
 */
export function viewStateFromContact(kind: ContactKind, contact: MemberContact): ViewContactState {
  if (kind === "whatsapp") {
    const value = contact.whatsapp;
    if (!value) return { status: "ok", kind, empty: true };
    return { status: "ok", kind, empty: false, whatsapp: { display: formatBrazilianWhatsapp(value), href: whatsappLink(value) } };
  }
  if (kind === "social") {
    const links = contact.social ?? [];
    return links.length === 0 ? { status: "ok", kind, empty: true } : { status: "ok", kind, empty: false, social: links };
  }
  const address = contact.email;
  if (!address) return { status: "ok", kind, empty: true };
  return { status: "ok", kind, empty: false, email: { address, href: emailShape.test(address) ? `mailto:${address}` : null } };
}
