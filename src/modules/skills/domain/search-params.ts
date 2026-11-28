/**
 * Filtros da busca de pessoas por habilidade na URL (#23): dá para salvar ou compartilhar uma busca. Puro: lê o que
 * veio da URL e descarta, sem quebrar a tela, o que não vale (o banco confere de novo, e a coordenação decide quem vê
 * quem). Nada daqui é texto livre: ids, um modo, UF, códigos e o cursor.
 */
export const maxSearchSkills = 5;

export type SearchMode = "all" | "any";
export type SearchCursor = { common: number; id: string };
export type SearchFilters = { skillIds: string[]; mode: SearchMode; state?: string; municipality?: number; unit?: string; noTeam?: boolean };
export type ParsedSearch = SearchFilters & { after?: SearchCursor };

type Raw = Record<string, string | string[] | undefined>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const list = (value: string | string[] | undefined): string[] => (Array.isArray(value) ? value : value === undefined ? [] : [value]);
const first = (value: string | string[] | undefined): string | undefined => list(value)[0];

export function parseSearchParams(raw: Raw): ParsedSearch {
  const skillIds = [...new Set(list(raw.h).filter((id) => UUID.test(id)))].slice(0, maxSearchSkills);
  const parsed: ParsedSearch = { skillIds, mode: first(raw.modo) === "qualquer" ? "any" : "all" };
  const state = first(raw.uf);
  if (state !== undefined && /^[A-Za-z]{2}$/.test(state)) parsed.state = state.toUpperCase();
  const municipality = first(raw.mun);
  if (municipality !== undefined && /^\d{1,7}$/.test(municipality)) parsed.municipality = Number(municipality);
  const unit = first(raw.equipe);
  if (unit !== undefined && UUID.test(unit)) parsed.unit = unit;
  if (first(raw.sem) === "1") parsed.noTeam = true;
  const common = first(raw.c);
  const id = first(raw.i);
  if (common !== undefined && /^\d{1,4}$/.test(common) && id !== undefined && UUID.test(id)) parsed.after = { common: Number(common), id };
  return parsed;
}

/** A query string dos filtros (e, se houver, o cursor da próxima página). O padrão não entra na URL. */
export function searchQueryString(filters: SearchFilters, after?: SearchCursor): string {
  const params = new URLSearchParams();
  for (const id of filters.skillIds) params.append("h", id);
  if (filters.mode === "any") params.set("modo", "qualquer");
  if (filters.state) params.set("uf", filters.state);
  if (filters.municipality !== undefined) params.set("mun", String(filters.municipality));
  if (filters.unit) params.set("equipe", filters.unit);
  if (filters.noTeam) params.set("sem", "1");
  if (after) {
    params.set("c", String(after.common));
    params.set("i", after.id);
  }
  return params.toString();
}
