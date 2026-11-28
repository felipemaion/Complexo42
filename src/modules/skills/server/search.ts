// Busca de pessoas por habilidade no servidor (#23). Usa o cliente com o JWT de quem está logado (R14): o banco
// decide o escopo (a nacional vê todos; os demais, `can_view_profile`), aplica o limite de 60 buscas por hora e
// audita. Toda entrada passa por Zod antes. O nome vem cifrado e só o da página é decifrado aqui; a lista nunca traz
// contato. Nada daqui vai para log além de códigos (R11).
import "server-only";
import { z } from "zod";
import type { HouseClient } from "@/modules/houses";
import { maxSearchSkills } from "../domain/search-params";

export type SearchError = "forbidden" | "invalid" | "rate_limited" | "failed";

const errorByCode: Record<string, SearchError> = { "42501": "forbidden", "22023": "invalid", "54000": "rate_limited" };

function errorOf(error: unknown): SearchError {
  const code = typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;
  return (typeof code === "string" && errorByCode[code]) || "failed";
}

export type PersonResult = {
  id: string;
  /** O nome decifrado, ou nulo se não pôde ser lido. */
  name: string | null;
  state: string | null;
  municipality: string | null;
  team: string | null;
  commonCount: number;
  skillIds: string[];
};

export type SearchResult = { ok: true; people: PersonResult[]; next: { common: number; id: string } | null } | { ok: false; error: SearchError };

export const defaultSearchPageSize = 20;
export const maxSearchPageSize = 50;

const input = z.strictObject({
  skillIds: z.array(z.guid()).min(1).max(maxSearchSkills),
  mode: z.enum(["all", "any"]),
  state: z.string().regex(/^[A-Z]{2}$/).optional(),
  municipality: z.number().int().positive().optional(),
  unit: z.guid().optional(),
  noTeam: z.boolean().optional(),
  limit: z.number().int().min(1).max(maxSearchPageSize).optional(),
  after: z.strictObject({ common: z.number().int().min(0), id: z.guid() }).optional(),
});

const row = z.object({
  profile_id: z.string(),
  display_name_enc: z.string().nullable(),
  state_code: z.string().nullable(),
  municipality_code: z.number().nullable(),
  team_name: z.string().nullable(),
  common_count: z.number(),
  skill_ids: z.array(z.string()),
});

type Decrypt = (value: string, context: { table: string; column: string; rowId: string }) => Promise<string>;

/** O nome do município de cada código da página (tabela pública, texto puro). */
async function municipalityNames(client: HouseClient, codes: number[]): Promise<Map<number, string>> {
  if (codes.length === 0) return new Map();
  const { data, error } = await client.from("municipalities").select("code,name").in("code", codes.map(String));
  if (error) return new Map();
  const parsed = z.array(z.object({ code: z.number(), name: z.string() })).safeParse(data ?? []);
  return new Map(parsed.success ? parsed.data.map((m) => [m.code, m.name]) : []);
}

export type SearchSkill = { id: string; name: string; category: string; aliases: string[] };

const searchSkillRow = z.object({ id: z.string(), name: z.string(), category: z.string(), active: z.boolean(), aliases: z.array(z.string()) });

/** O catálogo ativo com os sinônimos (já sem caixa e sem acento), para o autocomplete da busca. */
export async function listSearchSkills(client: HouseClient): Promise<SearchSkill[]> {
  const { data, error } = await client.from("skills").select("id,name,category,active,aliases").order("category", { ascending: true }).order("name", { ascending: true });
  if (error) throw new Error(`skills_read_failed:${errorOf(error)}`);
  return z
    .array(searchSkillRow)
    .parse(data ?? [])
    .filter((s) => s.active)
    .map(({ id, name, category, aliases }) => ({ id, name, category, aliases }));
}

export type MunicipalityOption = { code: number; name: string };
export type TeamOption = { id: string; name: string };

/** Os municípios de uma UF (tabela pública), por nome; UF fora do formato devolve vazio sem consultar. */
export async function listMunicipalities(client: HouseClient, state: string): Promise<MunicipalityOption[]> {
  if (!/^[A-Z]{2}$/.test(state)) return [];
  const { data, error } = await client.from("municipalities").select("code,name").eq("state_code", state).order("name", { ascending: true });
  if (error) return [];
  const parsed = z.array(z.object({ code: z.number(), name: z.string() })).safeParse(data ?? []);
  return parsed.success ? parsed.data : [];
}

/** As equipes (unidades de tipo equipe) que a RLS deixa a pessoa ver, por nome. */
export async function listTeams(client: HouseClient): Promise<TeamOption[]> {
  const types = await client.from("unit_types").select("id,is_team");
  if (types.error) return [];
  const teamTypes = z.array(z.object({ id: z.string(), is_team: z.boolean() })).safeParse(types.data ?? []);
  const ids = teamTypes.success ? teamTypes.data.filter((t) => t.is_team).map((t) => t.id) : [];
  if (ids.length === 0) return [];
  const { data, error } = await client.from("units").select("id,name").in("type_id", ids).order("name", { ascending: true }).limit(300);
  if (error) return [];
  const parsed = z.array(z.object({ id: z.string(), name: z.string() })).safeParse(data ?? []);
  return parsed.success ? parsed.data : [];
}

export async function searchPeople(client: HouseClient, raw: unknown, decrypt: Decrypt): Promise<SearchResult> {
  const parsed = input.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const filters = parsed.data;
  const limit = filters.limit ?? defaultSearchPageSize;
  const { data, error } = await client.rpc("search_people_by_skills", {
    p_skill_ids: filters.skillIds,
    p_mode: filters.mode,
    p_state: filters.state ?? null,
    p_municipality: filters.municipality ?? null,
    p_district: null,
    p_unit: filters.unit ?? null,
    p_no_team: filters.noTeam ?? false,
    p_limit: limit,
    p_after_common: filters.after?.common ?? null,
    p_after_id: filters.after?.id ?? null,
  });
  if (error) return { ok: false, error: errorOf(error) };
  const rows = z.array(row).safeParse(data ?? []);
  if (!rows.success) return { ok: false, error: "failed" };
  // O banco devolve até limite + 1: a sobra só diz que há outra página.
  const page = rows.data.slice(0, limit);
  const last = page.at(-1);
  const next = rows.data.length > limit && last ? { common: last.common_count, id: last.profile_id } : null;
  const names = await municipalityNames(client, [...new Set(page.flatMap((r) => (r.municipality_code === null ? [] : [r.municipality_code])))]);
  const people = await Promise.all(
    page.map(async (r): Promise<PersonResult> => {
      let name: string | null = null;
      if (r.display_name_enc) {
        try {
          name = await decrypt(r.display_name_enc, { table: "profiles", column: "display_name_enc", rowId: r.profile_id });
        } catch {
          name = null;
        }
      }
      return {
        id: r.profile_id,
        name,
        state: r.state_code,
        municipality: r.municipality_code === null ? null : (names.get(r.municipality_code) ?? null),
        team: r.team_name,
        commonCount: r.common_count,
        skillIds: r.skill_ids,
      };
    }),
  );
  return { ok: true, people, next };
}
