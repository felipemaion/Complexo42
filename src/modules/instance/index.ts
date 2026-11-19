export { InstanceConfigError, instanceConfigSchema, parseInstanceConfig, roleKeys } from "./domain/schema";
export { parseUnitTypeLabels, unitTypeLabel } from "./domain/unit-labels";
export type { UnitTypeLabels, UnitTypeRow } from "./domain/unit-labels";
export type { House, InstanceConfig, RoleKey } from "./types";
// Só no servidor (server-only): lê `unit_types` com o cliente da sessão.
export { readUnitTypeLabels } from "./server/unit-types";
export type { UnitTypesClient } from "./server/unit-types";
