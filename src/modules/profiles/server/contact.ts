// Contato no servidor (issue #119, ADR 0010). Tudo com o JWT de quem está logado (R14): o banco
// decide quem vê (`app.can_view_contact`, R15) e registra cada acesso (`contact_viewed`). O
// WhatsApp e as redes chegam cifrados e só são decifrados aqui (R13). Nenhum valor de contato
// nem nome vai para log (R11): só códigos.
import "server-only";
import { z } from "zod";
import { decryptField } from "@/server/crypto";
import { log as appLog, type Logger } from "@/server/log";
import {
  contactKinds,
  parseContactVisibilityChoice,
  visibilityFromRows,
  type ContactKind,
  type ContactView,
  type ContactVisibility,
  type MemberContact,
} from "../domain/contact";
import type { ProfileDbClient } from "../types";

export type ContactDeps = { decrypt: typeof decryptField; log: Logger };

const defaultDeps: ContactDeps = { decrypt: decryptField, log: appLog };

const uuid = z.guid();

/** Só o código do erro (Postgres/PostgREST), nunca a mensagem: ela pode trazer valores. */
function errorCode(error: unknown): string {
  const code = typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;
  return typeof code === "string" ? code.slice(0, 16) : "unknown";
}

/** A escolha atual da própria pessoa (a RLS só devolve as linhas dela). */
export async function loadContactVisibility(client: ProfileDbClient, userId: string): Promise<ContactVisibility> {
  const { data, error } = await client
    .from("contact_visibility")
    .select("kind, scope")
    .eq("profile_id", uuid.parse(userId));
  if (error) throw new Error(`contact_visibility_read_failed:${errorCode(error)}`);
  return visibilityFromRows(data ?? []);
}

export type SetContactVisibilityResult = { status: "saved" | "invalid" | "forbidden" | "failed" };

/** Grava a escolha de um contato. Vale na hora: a próxima leitura de qualquer pessoa já a usa. */
export async function setContactVisibility(
  client: ProfileDbClient,
  raw: unknown,
  deps: Pick<ContactDeps, "log"> = defaultDeps,
): Promise<SetContactVisibilityResult> {
  const choice = parseContactVisibilityChoice(raw);
  if (!choice) return { status: "invalid" };
  const { error } = await client.rpc("set_contact_visibility", { p_kind: choice.kind, p_scope: choice.scope });
  if (!error) return { status: "saved" };
  const code = errorCode(error);
  if (code === "42501") {
    deps.log.warn("contact_visibility_denied", { reason: code });
    return { status: "forbidden" };
  }
  if (code === "22023") return { status: "invalid" };
  deps.log.error("contact_visibility_failed", { reason: code });
  return { status: "failed" };
}

export type ViewMemberContactResult =
  | { status: "ok"; contact: MemberContact }
  | { status: "forbidden" }
  | { status: "failed" };

const socialLinks = z.array(z.string());

/**
 * "Ver contato" de outra pessoa: pede ao banco cada contato (`view_contact`), que só devolve os
 * permitidos e registra cada acesso. Os negados ficam de fora; se nenhum for permitido, a
 * resposta é `forbidden`. Um valor que não decifra vira `null` (registra só o nome da coluna).
 */
export async function viewMemberContact(
  client: ProfileDbClient,
  targetId: string,
  deps: ContactDeps = defaultDeps,
): Promise<ViewMemberContactResult> {
  const target = uuid.safeParse(targetId);
  if (!target.success) return { status: "forbidden" };
  const rowId = target.data;
  const contact: MemberContact = {};
  let allowed = 0;

  const open = async (value: string, column: string) => {
    try {
      return await deps.decrypt(value, { table: "profile_contacts", column, rowId });
    } catch (error) {
      deps.log.warn("contact_decrypt_failed", { column, reason: errorCode(error) });
      return null;
    }
  };

  for (const kind of contactKinds) {
    const { data, error } = await client.rpc("view_contact", { p_target: rowId, p_kind: kind });
    if (error) {
      const code = errorCode(error);
      if (code === "42501") continue;
      deps.log.error("contact_view_failed", { kind, reason: code });
      return { status: "failed" };
    }
    allowed += 1;
    const value = typeof data === "string" ? data : null;
    if (kind === "email") {
      contact.email = value;
    } else if (kind === "whatsapp") {
      contact.whatsapp = value === null ? null : await open(value, "whatsapp_enc");
    } else {
      // Sem redes cadastradas, ou um valor que não decifra: `null`.
      const raw = value === null ? null : await open(value, "social_links_enc");
      const links = socialLinks.safeParse(raw === null ? null : safeJson(raw));
      contact.social = links.success ? links.data : null;
    }
  }
  if (allowed === 0) return { status: "forbidden" };
  deps.log.info("contact_viewed", { kinds: Object.keys(contact) });
  return { status: "ok", contact };
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

const viewRows = z.array(
  z.object({
    viewer_id: z.string().nullable(),
    viewer_name_enc: z.string().nullable(),
    kind: z.enum(contactKinds),
    viewed_at: z.string().min(1),
  }),
);

/** Quem acessou o contato da própria pessoa, do mais recente, com o nome de quem viu decifrado. */
export async function listContactViews(client: ProfileDbClient, deps: ContactDeps = defaultDeps): Promise<ContactView[]> {
  const { data, error } = await client.rpc("list_contact_views", {});
  if (error) throw new Error(`contact_views_read_failed:${errorCode(error)}`);
  const rows = viewRows.parse(data ?? []);
  const names = new Map<string, Promise<string | null>>();
  const nameOf = (viewerId: string | null, enc: string | null): Promise<string | null> => {
    if (!viewerId || !enc) return Promise.resolve(null);
    let pending = names.get(viewerId);
    if (!pending) {
      pending = deps
        .decrypt(enc, { table: "profiles", column: "display_name_enc", rowId: viewerId })
        .catch((err: unknown) => {
          deps.log.warn("contact_views_decrypt_failed", { reason: errorCode(err) });
          return null;
        });
      names.set(viewerId, pending);
    }
    return pending;
  };
  return Promise.all(
    rows.map(async (row) => ({
      viewerName: await nameOf(row.viewer_id, row.viewer_name_enc),
      kind: row.kind as ContactKind,
      viewedAt: row.viewed_at,
    })),
  );
}
