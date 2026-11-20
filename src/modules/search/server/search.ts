import "server-only";
import { z } from "zod";
import { log } from "@/server/log";
import type { PersonResult, SearchActionResult, SearchClient, SkillOption } from "../types";

const skillRow = z.object({
  id: z.guid(),
  name: z.string(),
  category: z.string(),
});

const skillRows = z.array(skillRow);

const searchInputSchema = z.strictObject({
  skillIds: z.array(z.guid()).min(1).max(10),
  municipalityCode: z.coerce.number().int().positive().optional(),
});

const personRow = z.object({
  profile_id: z.guid(),
  display_name_enc: z.string(),
  municipality_code: z.number().int().nullable().optional(),
  skill_names: z.array(z.string()),
});

const personRows = z.array(personRow);

export async function listSkills(client: SearchClient): Promise<readonly SkillOption[]> {
  const { data, error } = await client.from("skills").select("id, name, category").order("category").order("name");
  if (error) throw new Error("skills_read_failed");
  return skillRows.parse(data);
}

export async function searchPeople(
  client: SearchClient,
  input: unknown,
  decrypt: (value: string, profileId: string) => Promise<string>,
): Promise<SearchActionResult<readonly PersonResult[]>> {
  const parsed = searchInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };

  const { data, error } = await client.rpc("search_people_by_skill", {
    p_skill_ids: parsed.data.skillIds,
    p_municipality_code: parsed.data.municipalityCode ?? null,
    p_limit: 50,
  });

  if (error) return { ok: false, error: "failed" };

  const parsedRows = personRows.safeParse(data);
  if (!parsedRows.success) return { ok: false, error: "failed" };

  const people: PersonResult[] = await Promise.all(
    parsedRows.data.map(async (row) => {
      let displayName: string;
      try {
        displayName = await decrypt(row.display_name_enc, row.profile_id);
      } catch {
        // Nome ilegível (chave trocada ou dado corrompido) não derruba a lista; só o código vai
        // para o log, nunca o nome nem o id (R11).
        log.warn("search_name_unreadable");
        displayName = "—";
      }

      return {
        profileId: row.profile_id,
        displayName,
        municipalityCode: row.municipality_code ?? null,
        skillNames: row.skill_names,
      };
    }),
  );

  return { ok: true, value: people };
}
