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
  type ContactAccess,
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

const accessRow = z.object({ whatsapp: z.boolean(), social: z.boolean(), email: z.boolean() });

/**
 * Quais contatos de `targetId` quem olha pode ver, só para decidir se mostra o botão. Não lê o valor, não audita e
 * não gasta a cota (`contact_access`). Qualquer falha vira "nenhum": o botão simplesmente não aparece.
 */
export async function readContactAccess(client: ProfileDbClient, targetId: string): Promise<ContactAccess> {
  const none: ContactAccess = { whatsapp: false, social: false, email: false };
  const target = uuid.safeParse(targetId);
  if (!target.success) return none;
  const { data, error } = await client.rpc("contact_access", { p_target: target.data });
  if (error) return none;
  const row = accessRow.safeParse(Array.isArray(data) ? data[0] : data);
  return row.success ? row.data : none;
}

export type ViewMemberContactResult =
  | { status: "ok"; contact: MemberContact }
  | { status: "forbidden" }
  | { status: "rate_limited" }
  | { status: "failed" };

const socialLinks = z.array(z.string());
const kindSchema = z.enum(contactKinds);

/**
 * "Ver contato" de outra pessoa: pede ao banco SÓ o contato que a tela quer (`view_contact`, um
 * tipo por chamada). O banco decide (42501 → `forbidden`), registra o acesso só quando há valor
 * (uma vez a cada 10 minutos por pessoa e tipo) e limita a 60 pessoas por hora (54000 →
 * `rate_limited`). A resposta traz só a chave pedida; sem valor, `null`. Um valor que não
 * decifra também vira `null` (o log leva só o nome da coluna).
 */
export async function viewMemberContact(
  client: ProfileDbClient,
  targetId: string,
  kind: ContactKind,
  deps: ContactDeps = defaultDeps,
): Promise<ViewMemberContactResult> {
  const target = uuid.safeParse(targetId);
  const parsedKind = kindSchema.safeParse(kind);
  if (!target.success || !parsedKind.success) return { status: "forbidden" };
  const rowId = target.data;

  const { data, error } = await client.rpc("view_contact", { p_target: rowId, p_kind: parsedKind.data });
  if (error) {
    const code = errorCode(error);
    if (code === "42501") return { status: "forbidden" };
    if (code === "54000") {
      deps.log.warn("contact_view_rate_limited");
      return { status: "rate_limited" };
    }
    deps.log.error("contact_view_failed", { kind: parsedKind.data, reason: code });
    return { status: "failed" };
  }

  const open = async (value: string, column: string) => {
    try {
      return await deps.decrypt(value, { table: "profile_contacts", column, rowId });
    } catch (error) {
      deps.log.warn("contact_decrypt_failed", { column, reason: errorCode(error) });
      return null;
    }
  };

  const value = typeof data === "string" ? data : null;
  let contact: MemberContact;
  if (parsedKind.data === "email") {
    contact = { email: value };
  } else if (parsedKind.data === "whatsapp") {
    contact = { whatsapp: value === null ? null : await open(value, "whatsapp_enc") };
  } else {
    // Sem redes cadastradas, ou um valor que não decifra: `null`.
    const raw = value === null ? null : await open(value, "social_links_enc");
    const links = socialLinks.safeParse(raw === null ? null : safeJson(raw));
    contact = { social: links.success ? links.data : null };
  }
  deps.log.info("contact_viewed", { kind: parsedKind.data });
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

/**
 * Quem acessou o contato da própria pessoa, do mais recente, com o nome de quem viu decifrado.
 * O id de quem viu só serve para o AAD da decifragem e não sai desta função (ADR 0010): a tela
 * recebe só o nome, o tipo e quando.
 */
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
