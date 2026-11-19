import type { z } from "zod";
import type { accessStatuses, profileContactInputSchema, profileInputSchema, profileStatuses } from "./domain/schema";

/** Dados do perfil já validados, em texto (antes de cifrar no servidor). */
export type ProfileInput = z.output<typeof profileInputSchema>;

/** Contato já validado, em texto (antes de cifrar no servidor). */
export type ProfileContactInput = z.output<typeof profileContactInputSchema>;

export type ProfileStatus = (typeof profileStatuses)[number];

/** Liberação pela lista de autorizados (ADR 0008 §1). */
export type AccessStatus = (typeof accessStatuses)[number];
