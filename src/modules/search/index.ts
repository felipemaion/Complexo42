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
export { MY_SKILLS_PATH, SEARCH_PATH } from "./paths";
// Habilidades da própria pessoa (#15).
export { MAX_MY_SKILLS, readMySkillIds, readSelectableSkills, saveMySkills, type SelectableSkill } from "./server/my-skills";
export { SkillPicker } from "./components/skill-picker";
// Catálogo de habilidades (#25): só o gestor nacional.
export { parseAliases, readSkillsCatalog, saveSkill, toggleSkill, type CatalogSkill, type CatalogClient } from "./server/catalog";
export const SKILLS_CATALOG_PATH = "/coordenacao/habilidades";
