import type { DistrictOption, MunicipalityOption } from "../types";

// Regras puras da escolha de localização (issue #175): busca no município e quando o distrito
// aparece. Quem confere de verdade que o distrito é do município é o banco (`save_own_profile`).

/** Minúsculas e sem acento, para "sao paulo" achar "São Paulo". */
export function normalizeForSearch(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();
}

/**
 * Municípios cujo nome contém o texto buscado. A cidade já escolhida nunca some da lista, para o
 * campo não ficar sem opção selecionada enquanto a pessoa digita outra busca.
 */
export function filterMunicipalities(
  options: readonly MunicipalityOption[],
  query: string,
  selectedCode: number | null,
): MunicipalityOption[] {
  const wanted = normalizeForSearch(query);
  if (wanted === "") return [...options];
  return options.filter((option) => option.code === selectedCode || normalizeForSearch(option.name).includes(wanted));
}

/**
 * Só há o que escolher quando o município tem mais de um distrito. Com um só (a sede), a escolha
 * fica escondida e o perfil guarda distrito nulo: o distrito seria o próprio município.
 */
export function hasDistrictChoice(districts: readonly DistrictOption[]): boolean {
  return districts.length > 1;
}
