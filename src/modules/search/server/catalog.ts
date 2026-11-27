import "server-only";
import { z } from "zod";

// Catálogo de habilidades (#25): o gestor nacional cria, edita (nome, área, sinônimos) e desativa.
// Quem pode o banco decide; desativar não apaga quem já marcou a habilidade.

export type CatalogClient = {
  readonly rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{ readonly data: unknown; readonly error: unknown }>;
};
export type CatalogSkill = { readonly id: string; readonly name: string; readonly category: string; readonly aliases: readonly string[]; readonly active: boolean };
export type CatalogError = "invalid" | "not_allowed" | "duplicate" | "failed";
export type CatalogResult = { readonly ok: true } | { readonly ok: false; readonly error: CatalogError };

function mapError(error: unknown): CatalogError {
  const code = typeof error === "object" && error !== null && "code" in error ? String((error as { code: unknown }).code) : "";
  if (code === "42501") return "not_allowed";
  if (code === "23505") return "duplicate";
  if (code === "22023" || code === "23514") return "invalid";
  return "failed";
}

/** "a, b ,, c" → ["a", "b"] (só sinônimos de 2 a 80 letras). */
export function parseAliases(raw: string): string[] {
  return raw
    .split(",")
    .map((alias) => alias.trim())
    .filter((alias) => alias.length >= 2 && alias.length <= 80);
}

export async function readSkillsCatalog(client: CatalogClient): Promise<readonly CatalogSkill[]> {
  const { data, error } = await client.rpc("skills_catalog", {});
  if (error) throw new Error("catalog_read_failed");
  return z
    .array(z.object({ id: z.guid(), name: z.string(), category: z.string(), aliases: z.array(z.string()).nullable(), active: z.boolean() }))
    .parse(data)
    .map((row) => ({ ...row, aliases: row.aliases ?? [] }));
}

export async function saveSkill(client: CatalogClient, input: unknown): Promise<CatalogResult> {
  const parsed = z
    .object({
      skillId: z.string(),
      name: z.string().trim().min(2).max(80),
      category: z.string().trim().min(2).max(80),
      aliases: z.string().max(1000),
    })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const { skillId, name, category } = parsed.data;
  const aliases = parseAliases(parsed.data.aliases);
  const id = z.guid().safeParse(skillId);
  if (skillId !== "" && !id.success) return { ok: false, error: "invalid" };
  const { error } = id.success
    ? await client.rpc("update_skill", { p_skill: id.data, p_name: name, p_category: category, p_aliases: aliases })
    : await client.rpc("create_skill", { p_name: name, p_category: category, p_aliases: aliases });
  return error ? { ok: false, error: mapError(error) } : { ok: true };
}

export async function toggleSkill(client: CatalogClient, input: unknown): Promise<CatalogResult> {
  const parsed = z.object({ skillId: z.guid(), active: z.enum(["true", "false"]) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const { error } = await client.rpc("set_skill_active", { p_skill: parsed.data.skillId, p_active: parsed.data.active === "true" });
  return error ? { ok: false, error: mapError(error) } : { ok: true };
}
