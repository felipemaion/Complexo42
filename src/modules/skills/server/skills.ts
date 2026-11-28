// Habilidades no servidor (#15). Usa o cliente com o JWT de quem está logado (R14): o banco decide quem
// grava (`set_my_skills`, `suggest_skill`) e quem aprova (`decide_skill_suggestion`, só a coordenação
// nacional), confere o limite de 10 e os de sugestão. Toda entrada passa por Zod antes (R15). Nada daqui
// vai para log além de códigos.
import "server-only";
import { z } from "zod";
import type { HouseClient } from "@/modules/houses";
import { maxSkillsPerPerson, parseSkillName, skillNameLimits } from "../domain/skill-name";

export type SkillError = "forbidden" | "invalid" | "limit" | "not_found" | "too_many_open" | "daily_limit" | "exists" | "merge_invalid" | "failed";
export type SkillResult = { ok: true } | { ok: false; error: SkillError };

const errorByCode: Record<string, SkillError> = {
  "42501": "forbidden",
  "22023": "invalid",
  C7701: "limit",
  P0002: "not_found",
  C7702: "too_many_open",
  C7703: "daily_limit",
  C7704: "exists",
  C7705: "merge_invalid",
};

function errorOf(error: unknown): SkillError {
  const code = typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;
  return (typeof code === "string" && errorByCode[code]) || "failed";
}

const readError = (what: string, error: unknown) => new Error(`${what}_read_failed:${errorOf(error)}`);

export type SkillView = { id: string; name: string; category: string };
export type MySuggestionView = { id: string; name: string; status: "open" | "approved" | "rejected"; createdAt: string };
export type QueueSuggestionView = { id: string; name: string; createdAt: string };

const catalogRow = z.object({ id: z.string(), name: z.string(), category: z.string(), active: z.boolean() });

/** O catálogo ativo, por grupo e nome. */
export async function listCatalog(client: HouseClient): Promise<SkillView[]> {
  const { data, error } = await client.from("skills").select("id,name,category,active").order("category", { ascending: true }).order("name", { ascending: true });
  if (error) throw readError("skills", error);
  return z
    .array(catalogRow)
    .parse(data ?? [])
    .filter((row) => row.active)
    .map(({ id, name, category }) => ({ id, name, category }));
}

/** Os ids das habilidades da própria pessoa. */
export async function readMySkillIds(client: HouseClient, userId: string): Promise<string[]> {
  const { data, error } = await client.from("profile_skills").select("skill_id").eq("profile_id", userId);
  if (error) throw readError("skills", error);
  return z.array(z.object({ skill_id: z.string() })).parse(data ?? []).map((row) => row.skill_id);
}

/** Troca o conjunto de habilidades da pessoa (até 10). O banco confere a pessoa, o limite e as inativas. */
export async function setMySkills(client: HouseClient, input: unknown): Promise<SkillResult> {
  const parsed = z.strictObject({ skillIds: z.array(z.guid()).max(500) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const ids = [...new Set(parsed.data.skillIds)];
  if (ids.length > maxSkillsPerPerson) return { ok: false, error: "limit" };
  const { error } = await client.rpc("set_my_skills", { p_skill_ids: ids });
  return error ? { ok: false, error: errorOf(error) } : { ok: true };
}

/** Sugere uma habilidade nova. O nome é validado aqui e de novo no banco; a coordenação nacional decide. */
export async function suggestSkill(client: HouseClient, input: unknown): Promise<SkillResult> {
  const parsed = z.strictObject({ name: z.string().max(skillNameLimits.max * 4) }).safeParse(input);
  const name = parsed.success ? parseSkillName(parsed.data.name) : null;
  if (name === null) return { ok: false, error: "invalid" };
  const { error } = await client.rpc("suggest_skill", { p_name: name });
  return error ? { ok: false, error: errorOf(error) } : { ok: true };
}

const mySuggestionRow = z.object({ id: z.string(), name: z.string(), status: z.enum(["open", "approved", "rejected"]), created_at: z.string() });

/** As sugestões da própria pessoa, das mais novas. */
export async function listMySuggestions(client: HouseClient, userId: string): Promise<MySuggestionView[]> {
  const { data, error } = await client.from("skill_suggestions").select("id,name,status,created_at").eq("profile_id", userId).order("created_at", { ascending: false });
  if (error) throw readError("suggestions", error);
  return z
    .array(mySuggestionRow)
    .parse(data ?? [])
    .map((row) => ({ id: row.id, name: row.name, status: row.status, createdAt: row.created_at }));
}

const queueRow = z.object({ id: z.string(), name: z.string(), created_at: z.string() });

/** A fila da coordenação nacional: nome e data, sem quem sugeriu (não é preciso para decidir). */
export async function listOpenSuggestions(client: HouseClient): Promise<QueueSuggestionView[]> {
  const { data, error } = await client.from("skill_suggestions").select("id,name,created_at").eq("status", "open").order("created_at", { ascending: true }).limit(200);
  if (error) throw readError("suggestions", error);
  return z
    .array(queueRow)
    .parse(data ?? [])
    .map((row) => ({ id: row.id, name: row.name, createdAt: row.created_at }));
}

/** Aprova (com o grupo no catálogo) ou rejeita. O banco confere que quem chama é a coordenação nacional. */
export async function decideSuggestion(client: HouseClient, input: unknown): Promise<SkillResult> {
  const parsed = z
    .strictObject({ suggestionId: z.guid(), approve: z.boolean(), category: z.string().max(200).optional() })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const category = parsed.data.approve ? parseSkillName(parsed.data.category) : null;
  if (parsed.data.approve && category === null) return { ok: false, error: "invalid" };
  const { error } = await client.rpc("decide_skill_suggestion", { p_id: parsed.data.suggestionId, p_approve: parsed.data.approve, p_category: category });
  return error ? { ok: false, error: errorOf(error) } : { ok: true };
}

export type AdminSkillView = { id: string; name: string; category: string; active: boolean };

/** O catálogo inteiro (com as desativadas) para a coordenação nacional gerir. */
export async function listAdminCatalog(client: HouseClient): Promise<AdminSkillView[]> {
  const { data, error } = await client.from("skills").select("id,name,category,active").order("category", { ascending: true }).order("name", { ascending: true });
  if (error) throw readError("skills", error);
  return z.array(catalogRow).parse(data ?? []);
}

const idInput = z.guid();
const textInput = z.string().max(skillNameLimits.max * 4);

async function callAdmin(client: HouseClient, fn: string, args: Record<string, unknown>): Promise<SkillResult> {
  const { error } = await client.rpc(fn, args);
  return error ? { ok: false, error: errorOf(error) } : { ok: true };
}

/** Cria uma habilidade no grupo dado (existente ou novo). O banco confere que quem chama é a coordenação nacional. */
export async function createSkill(client: HouseClient, input: { name: unknown; category: unknown }): Promise<SkillResult> {
  const parsed = z.object({ name: textInput, category: textInput }).safeParse(input);
  const name = parsed.success ? parseSkillName(parsed.data.name) : null;
  const category = parsed.success ? parseSkillName(parsed.data.category) : null;
  if (name === null || category === null) return { ok: false, error: "invalid" };
  return callAdmin(client, "create_skill", { p_name: name, p_category: category });
}

/** Renomeia a habilidade; o id e quem a tem não mudam. */
export async function renameSkill(client: HouseClient, input: { id: unknown; name: unknown }): Promise<SkillResult> {
  const id = idInput.safeParse(input.id);
  const name = textInput.safeParse(input.name);
  const clean = name.success ? parseSkillName(name.data) : null;
  if (!id.success || clean === null) return { ok: false, error: "invalid" };
  return callAdmin(client, "rename_skill", { p_id: id.data, p_name: clean });
}

/** Move uma habilidade para outro grupo. */
export async function moveSkill(client: HouseClient, input: { id: unknown; category: unknown }): Promise<SkillResult> {
  const id = idInput.safeParse(input.id);
  const category = textInput.safeParse(input.category);
  const clean = category.success ? parseSkillName(category.data) : null;
  if (!id.success || clean === null) return { ok: false, error: "invalid" };
  return callAdmin(client, "move_skill", { p_id: id.data, p_category: clean });
}

/** Renomeia um grupo inteiro, à parte de renomear habilidade. */
export async function renameSkillGroup(client: HouseClient, input: { from: unknown; to: unknown }): Promise<SkillResult> {
  const from = textInput.safeParse(input.from);
  const to = textInput.safeParse(input.to);
  const oldName = from.success ? parseSkillName(from.data) : null;
  const newName = to.success ? parseSkillName(to.data) : null;
  if (oldName === null || newName === null) return { ok: false, error: "invalid" };
  return callAdmin(client, "rename_skill_group", { p_old: oldName, p_new: newName });
}

/** Ativa ou desativa uma habilidade. */
export async function setSkillActive(client: HouseClient, input: { id: unknown; active: unknown }): Promise<SkillResult> {
  const parsed = z.strictObject({ id: idInput, active: z.boolean() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  return callAdmin(client, "set_skill_active", { p_id: parsed.data.id, p_active: parsed.data.active });
}

/** Mescla a duplicada na habilidade que fica. */
export async function mergeSkills(client: HouseClient, input: { from: unknown; to: unknown }): Promise<SkillResult> {
  const from = idInput.safeParse(input.from);
  const to = idInput.safeParse(input.to);
  if (!from.success || !to.success) return { ok: false, error: "invalid" };
  if (from.data === to.data) return { ok: false, error: "merge_invalid" };
  return callAdmin(client, "merge_skills", { p_from: from.data, p_to: to.data });
}
