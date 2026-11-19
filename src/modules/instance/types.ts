import type { z } from "zod";
import type { instanceConfigSchema, roleKeys } from "./domain/schema";

/** Papéis genéricos do sistema (ADR 0002/0005). O rótulo exibido vem de `config/`. */
export type RoleKey = (typeof roleKeys)[number];

/** Configuração da instância já validada (ADR 0005 §3, ADR 0008 §2). */
export type InstanceConfig = z.infer<typeof instanceConfigSchema>;

export type House = InstanceConfig["houses"][number];
