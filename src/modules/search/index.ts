export type {
  PersonResult,
  SearchActionResult,
  SearchClient,
  SearchQuery,
  SearchQueryResult,
  SearchText,
  SkillOption,
} from "./types";

export { listSkills, searchPeople } from "./server/search";
export { sessionSearchClient } from "./server/session";
export { SearchForm } from "./components/search-form";
export { PersonList } from "./components/person-list";
export { SEARCH_PATH } from "./paths";
// Catálogo de habilidades (#25): só o gestor nacional.
export { parseAliases, readSkillsCatalog, saveSkill, toggleSkill, type CatalogSkill, type CatalogClient } from "./server/catalog";
export const SKILLS_CATALOG_PATH = "/coordenacao/habilidades";
