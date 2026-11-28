// Publicar, arquivar e listar novidades (#307), com o cliente da sessão (R14). Só composição: quem decide é o banco
// (`publish_news` e `archive_news` conferem o escopo de gestor, R15). Só o código curto do erro sobe, nunca a mensagem.
import "server-only";
import { z } from "zod";
import type { HouseClient } from "../types";

export type NewsAdminError = "invalid" | "forbidden" | "failed";

function errorOf(error: unknown): NewsAdminError {
  const code = typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;
  if (code === "42501") return "forbidden";
  if (code === "22023") return "invalid";
  return "failed";
}

const publishInput = z.strictObject({
  unitId: z.uuid(),
  title: z.string().min(1).max(80),
  body: z.string().min(1).max(280),
  link: z.string().max(300).nullable(),
  expiresAt: z.string().nullable(),
});

export async function publishNews(client: HouseClient, input: unknown): Promise<{ ok: true; id: string } | { ok: false; error: NewsAdminError }> {
  const parsed = publishInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const { unitId, title, body, link, expiresAt } = parsed.data;
  const { data, error } = await client.rpc("publish_news", { p_unit: unitId, p_title: title, p_body: body, p_link: link, p_expires_at: expiresAt });
  if (error) return { ok: false, error: errorOf(error) };
  const id = z.uuid().safeParse(data);
  return id.success ? { ok: true, id: id.data } : { ok: false, error: "failed" };
}

export async function archiveNews(client: HouseClient, input: unknown): Promise<{ ok: true } | { ok: false; error: NewsAdminError }> {
  const parsed = z.strictObject({ id: z.uuid() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const { error } = await client.rpc("archive_news", { p_id: parsed.data.id });
  return error ? { ok: false, error: errorOf(error) } : { ok: true };
}

const roleRows = z.array(z.object({ unit: z.object({ id: z.string(), path: z.string() }) }));
const unitRows = z.array(z.object({ id: z.string(), name: z.string(), path: z.string() }));

/** Só conforto: a unidade do papel de gestor e as de baixo. O banco recusa o resto. Falha na leitura: lista vazia. */
export async function readNewsUnits(client: HouseClient, userId: string): Promise<{ id: string; name: string }[]> {
  const roles = await client
    .from("role_assignments")
    .select("unit:units!inner(id,path)")
    .eq("profile_id", userId)
    .eq("role", "manager")
    .is("revoked_at", null);
  const mine = roles.error ? null : roleRows.safeParse(roles.data);
  if (!mine?.success || mine.data.length === 0) return [];
  const all = await client.from("units").select("id,name,path").order("path", { ascending: true });
  const rows = all.error ? null : unitRows.safeParse(all.data);
  if (!rows?.success) return [];
  const roots = mine.data.map((row) => row.unit.path);
  return rows.data
    .filter((unit) => roots.some((root) => unit.path === root || unit.path.startsWith(`${root}.`)))
    .map(({ id, name }) => ({ id, name }));
}

const newsRows = z.array(z.object({ id: z.string(), unit_id: z.string(), title: z.string(), published_at: z.string(), expires_at: z.string().nullable() }));

export type ManagedNews = { id: string; unitId: string; title: string; publishedAt: string; expiresAt: string | null };

/** As novidades que a RLS deixa a pessoa ver (as ativas do nível dela e de cima), as mais novas primeiro. */
export async function readManagedNews(client: HouseClient): Promise<ManagedNews[]> {
  const { data, error } = await client
    .from("news")
    .select("id,unit_id,title,published_at,expires_at")
    .order("published_at", { ascending: false })
    .limit(50);
  const rows = error ? null : newsRows.safeParse(data);
  if (!rows?.success) return [];
  return rows.data.map((row) => ({ id: row.id, unitId: row.unit_id, title: row.title, publishedAt: row.published_at, expiresAt: row.expires_at }));
}
