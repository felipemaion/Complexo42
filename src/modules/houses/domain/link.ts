/*
 * Ligação entre a casa de config/instance.ts e a unidade do eixo `house` (#76): o `slug` da
 * unidade é o `id` da casa com `_` no lugar de `-`. O banco faz a mesma troca em
 * `app.house_unit_for`; tests/house-units.test.ts confere o seed contra a config.
 */

/** `minha-casa-1` → `minha_casa_1`. */
export function houseUnitSlug(houseId: string): string {
  return houseId.replaceAll("-", "_");
}

/** A casa da config cuja unidade tem este slug, ou null. */
export function houseIdFromUnitSlug(slug: string, houseIds: readonly string[]): string | null {
  return houseIds.find((id) => houseUnitSlug(id) === slug) ?? null;
}
