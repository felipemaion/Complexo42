import "server-only";
import { z } from "zod";
import type { TeamsClient } from "../types";

// Equipes de antes da plataforma (#136): a própria pessoa informa (nome, quando, papel), sem
// confirmação. É só informação do perfil: não dá escopo, visibilidade nem acesso a ninguém. Não
// guarda colegas (seria dado de terceiros). Quem vê e quem mexe o banco decide.

export const PRIOR_TEAM_ROLES = ["member", "spokesperson", "coordinator"] as const;
export type PriorTeamRole = (typeof PRIOR_TEAM_ROLES)[number];
export const MAX_PRIOR_TEAMS = 5;

export type PriorTeam = {
  readonly id: string;
  readonly teamName: string;
  readonly period: string;
  readonly role: PriorTeamRole;
};

export type PriorTeamError = "invalid" | "full" | "not_allowed" | "failed";
export type PriorTeamResult = { readonly ok: true } | { readonly ok: false; readonly error: PriorTeamError };

const addInput = z.object({
  teamName: z.string().trim().min(2).max(80),
  period: z.string().trim().min(1).max(40),
  role: z.enum(PRIOR_TEAM_ROLES),
});

const rows = z.array(
  z.object({ id: z.guid(), team_name: z.string(), period: z.string(), role: z.enum(PRIOR_TEAM_ROLES), position: z.number() }),
);

function mapError(error: unknown): PriorTeamError {
  const code = typeof error === "object" && error !== null && "code" in error ? String((error as { code: unknown }).code) : "";
  const message = typeof error === "object" && error !== null && "message" in error ? String((error as { message: unknown }).message) : "";
  if (code === "42501") return "not_allowed";
  if (code === "22023") return message.includes("até 5") ? "full" : "invalid";
  return "failed";
}

export async function addPriorTeam(client: TeamsClient, input: unknown): Promise<PriorTeamResult> {
  const parsed = addInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const { error } = await client.rpc("add_prior_team", {
    p_team_name: parsed.data.teamName,
    p_period: parsed.data.period,
    p_role: parsed.data.role,
  });
  return error ? { ok: false, error: mapError(error) } : { ok: true };
}

export async function removePriorTeam(client: TeamsClient, itemId: unknown): Promise<PriorTeamResult> {
  const parsed = z.guid().safeParse(itemId);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const { error } = await client.rpc("remove_prior_team", { p_item: parsed.data });
  return error ? { ok: false, error: mapError(error) } : { ok: true };
}

/** Equipes de antes da plataforma de uma pessoa: a própria pessoa ou a coordenação do escopo dela. */
export async function readPriorTeams(client: TeamsClient, profileId: string): Promise<readonly PriorTeam[]> {
  const { data, error } = await client.rpc("prior_teams_list", { p_profile: profileId });
  if (error) throw new Error("prior_teams_read_failed");
  const parsed = rows.safeParse(data);
  if (!parsed.success) throw new Error("prior_teams_read_failed");
  return parsed.data.map((row) => ({ id: row.id, teamName: row.team_name, period: row.period, role: row.role }));
}
