import "server-only";
import { z } from "zod";
import { log } from "@/server/log";
import type {
  PersonOption,
  TeamActionResult,
  TeamErrorCode,
  TeamMember,
  TeamParent,
  TeamsClient,
  TeamSummary,
} from "../types";

const teamParentRow = z.object({
  id: z.guid(),
  name: z.string(),
  depth: z.number().int(),
});

const teamParentRows = z.array(teamParentRow);

const teamSummaryRow = z.object({
  id: z.guid(),
  name: z.string(),
  parent_id: z.guid(),
  parent_name: z.string(),
  member_count: z.number().int(),
});

const teamSummaryRows = z.array(teamSummaryRow);

const teamMemberRow = z.object({
  profile_id: z.guid(),
  display_name_enc: z.string(),
  is_lead: z.boolean(),
});

const teamMemberRows = z.array(teamMemberRow);

const unassignedRow = z.object({
  profile_id: z.guid(),
  display_name_enc: z.string(),
});

const unassignedRows = z.array(unassignedRow);

const createTeamSchema = z.strictObject({
  parentId: z.guid(),
  name: z.string().trim().min(2).max(60),
});

const teamMembershipSchema = z.strictObject({
  profileId: z.guid(),
  teamId: z.guid(),
});

function mapDatabaseError(error: unknown): TeamErrorCode {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = String((error as { readonly code?: unknown }).code);
    if (code === "42501") return "not_allowed";
    if (code === "22023") return "invalid";
  }
  return "failed";
}

export async function readTeamParents(client: TeamsClient): Promise<readonly TeamParent[]> {
  const { data, error } = await client.rpc("team_parents");
  if (error) throw new Error("teams_read_failed");

  const parsed = teamParentRows.safeParse(data);
  if (!parsed.success) throw new Error("teams_read_failed");

  return parsed.data.map((row) => ({
    id: row.id,
    name: row.name,
    depth: row.depth,
  }));
}

export async function readMyTeams(client: TeamsClient): Promise<readonly TeamSummary[]> {
  const { data, error } = await client.rpc("my_teams");
  if (error) throw new Error("teams_read_failed");

  const parsed = teamSummaryRows.safeParse(data);
  if (!parsed.success) throw new Error("teams_read_failed");

  return parsed.data.map((row) => ({
    id: row.id,
    name: row.name,
    parentId: row.parent_id,
    parentName: row.parent_name,
    memberCount: row.member_count,
  }));
}

export async function readTeamMembers(
  client: TeamsClient,
  teamId: string,
  decrypt: (value: string, profileId: string) => Promise<string>,
): Promise<readonly TeamMember[]> {
  const { data, error } = await client.rpc("team_members", { p_team: teamId });
  if (error) throw new Error("teams_read_failed");

  const parsed = teamMemberRows.safeParse(data);
  if (!parsed.success) throw new Error("teams_read_failed");

  return Promise.all(
    parsed.data.map(async (row) => {
      const displayName = await decrypt(row.display_name_enc, row.profile_id).catch(
        (decryptError: unknown) => {
          log.warn("teams_name_unreadable", { error: String(decryptError) });
          return "—";
        },
      );

      return {
        profileId: row.profile_id,
        displayName,
        isLead: row.is_lead,
      };
    }),
  );
}

export async function readUnassigned(
  client: TeamsClient,
  parentId: string,
  decrypt: (value: string, profileId: string) => Promise<string>,
): Promise<readonly PersonOption[]> {
  const { data, error } = await client.rpc("unassigned_people", { p_parent: parentId });
  if (error) throw new Error("teams_read_failed");

  const parsed = unassignedRows.safeParse(data);
  if (!parsed.success) throw new Error("teams_read_failed");

  return Promise.all(
    parsed.data.map(async (row) => {
      const displayName = await decrypt(row.display_name_enc, row.profile_id).catch(
        (decryptError: unknown) => {
          log.warn("teams_name_unreadable", { error: String(decryptError) });
          return "—";
        },
      );

      return {
        profileId: row.profile_id,
        displayName,
      };
    }),
  );
}

export async function createTeam(
  client: TeamsClient,
  input: unknown,
): Promise<TeamActionResult> {
  const parsed = createTeamSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };

  const { error } = await client.rpc("create_team", {
    p_parent: parsed.data.parentId,
    p_name: parsed.data.name,
  });

  if (error) return { ok: false, error: mapDatabaseError(error) };
  return { ok: true };
}

export async function assignToTeam(
  client: TeamsClient,
  input: unknown,
): Promise<TeamActionResult> {
  const parsed = teamMembershipSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };

  const { error } = await client.rpc("assign_to_team", {
    p_profile: parsed.data.profileId,
    p_team: parsed.data.teamId,
  });

  if (error) return { ok: false, error: mapDatabaseError(error) };
  return { ok: true };
}

export async function removeFromTeam(
  client: TeamsClient,
  input: unknown,
): Promise<TeamActionResult> {
  const parsed = teamMembershipSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };

  const { error } = await client.rpc("remove_from_team", {
    p_profile: parsed.data.profileId,
    p_team: parsed.data.teamId,
  });

  if (error) return { ok: false, error: mapDatabaseError(error) };
  return { ok: true };
}

export async function setTeamLead(
  client: TeamsClient,
  input: unknown,
): Promise<TeamActionResult> {
  const parsed = teamMembershipSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };

  const { error } = await client.rpc("set_team_lead", {
    p_team: parsed.data.teamId,
    p_profile: parsed.data.profileId,
  });

  if (error) return { ok: false, error: mapDatabaseError(error) };
  return { ok: true };
}

// Mover pessoa de uma equipe para outra (#47). Quem pode o banco decide (move_to_team: quem
// coordena as duas equipes) e registra member_moved no audit_log.
const moveSchema = z
  .strictObject({ profileId: z.guid(), fromTeamId: z.guid(), toTeamId: z.guid() })
  .refine((input) => input.fromTeamId !== input.toTeamId);

export async function moveToTeam(client: TeamsClient, input: unknown): Promise<TeamActionResult> {
  const parsed = moveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const { error } = await client.rpc("move_to_team", {
    p_profile: parsed.data.profileId,
    p_from: parsed.data.fromTeamId,
    p_to: parsed.data.toTeamId,
  });
  if (error) return { ok: false, error: mapDatabaseError(error) };
  return { ok: true };
}
