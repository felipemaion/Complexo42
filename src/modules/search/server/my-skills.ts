import "server-only";
import { z } from "zod";
import type { SearchClient } from "../types";

// A pessoa marca as próprias habilidades do catálogo (#15). Só habilidades ativas, até 12; quem
// pode e o que vale o banco confere de novo (set_my_skills). Sem opção "outra" (não aprovada).

export const MAX_MY_SKILLS = 12;

export type SelectableSkill = {
  readonly id: string;
  readonly name: string;
  readonly category: string;
  readonly aliases: readonly string[];
};

export type MySkillsError = "invalid" | "too_many" | "not_allowed" | "failed";
export type MySkillsResult = { readonly ok: true; readonly count: number } | { readonly ok: false; readonly error: MySkillsError };

const catalogRows = z.array(
  z.object({ id: z.guid(), name: z.string(), category: z.string(), aliases: z.array(z.string()), active: z.boolean() }),
);
const myRows = z.array(z.object({ skill_id: z.guid() }));

function mapError(error: unknown): MySkillsError {
  const code = typeof error === "object" && error !== null && "code" in error ? String((error as { code: unknown }).code) : "";
  const message = typeof error === "object" && error !== null && "message" in error ? String((error as { message: unknown }).message) : "";
  if (code === "42501") return "not_allowed";
  if (code === "22023") return message.includes("até 12") ? "too_many" : "invalid";
  return "failed";
}

/** Catálogo que a pessoa pode marcar: só as ativas, por área e nome. */
export async function readSelectableSkills(client: SearchClient): Promise<readonly SelectableSkill[]> {
  const { data, error } = await client.from("skills").select("id, name, category, aliases, active").order("category").order("name");
  if (error) throw new Error("skills_read_failed");
  const parsed = catalogRows.safeParse(data);
  if (!parsed.success) throw new Error("skills_read_failed");
  return parsed.data.filter((s) => s.active).map(({ id, name, category, aliases }) => ({ id, name, category, aliases }));
}

/** Ids das habilidades que quem está logado marcou. */
export async function readMySkillIds(client: SearchClient): Promise<readonly string[]> {
  const { data, error } = await client.rpc("my_skills", {});
  if (error) throw new Error("my_skills_read_failed");
  const parsed = myRows.safeParse(data);
  if (!parsed.success) throw new Error("my_skills_read_failed");
  return parsed.data.map((row) => row.skill_id);
}

/** Troca a lista da pessoa pela marcada no formulário (ids repetidos contam uma vez). */
export async function saveMySkills(client: SearchClient, input: unknown): Promise<MySkillsResult> {
  const parsed = z.array(z.guid()).max(100).safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const ids = [...new Set(parsed.data)];
  if (ids.length > MAX_MY_SKILLS) return { ok: false, error: "too_many" };
  const { data, error } = await client.rpc("set_my_skills", { p_skills: ids });
  if (error) return { ok: false, error: mapError(error) };
  const count = z.number().int().nonnegative().safeParse(data);
  return count.success ? { ok: true, count: count.data } : { ok: false, error: "failed" };
}
