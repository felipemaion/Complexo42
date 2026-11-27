import "server-only";
import { z } from "zod";
import { log } from "@/server/log";
import {
  GRADES,
  type ChatMessage,
  type CollabClient,
  type CollabErrorCode,
  type CollabResult,
  type DashboardRow,
  type MyTeam,
  type TeamMate,
} from "../types";

const myOpenTeamRow = z.object({
  team_id: z.guid(),
  team_name: z.string(),
});

const myOpenTeamRows = z.array(myOpenTeamRow);

const teamMemberRow = z.object({
  profile_id: z.guid(),
  display_name_enc: z.string(),
  is_lead: z.boolean(),
});

const teamMemberRows = z.array(teamMemberRow);

const teamMessageRow = z.object({
  message_id: z.guid(),
  author_id: z.guid(),
  author_name_enc: z.string(),
  body_enc: z.string(),
  created_at: z.string(),
  is_mine: z.boolean(),
});

const teamMessageRows = z.array(teamMessageRow);

const dashboardRowSchema = z.object({
  team_id: z.guid(),
  team_name: z.string(),
  member_count: z.number().int(),
  active_runs: z.number().int(),
  completed_runs: z.number().int(),
  team_points: z.number().int(),
});

const dashboardRowsSchema = z.array(dashboardRowSchema);

const postMessageSchema = z.strictObject({
  teamId: z.guid(),
  body: z.string().trim().min(1).max(1000),
});

const submitEvaluationSchema = z.strictObject({
  profileId: z.guid(),
  grade: z.enum(GRADES),
  note: z.string().trim().max(500).optional(),
});

function mapCollabError(error: unknown): CollabErrorCode {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = String((error as { readonly code?: unknown }).code);
    if (code === "42501") return "not_allowed";
    if (code === "22023") return "invalid";
    if (code === "C7614") return "too_many";
  }
  return "failed";
}

export async function readMyTeam(client: CollabClient): Promise<MyTeam | null> {
  const { data, error } = await client.rpc("my_open_team");
  if (error) throw new Error("collab_read_failed");

  const parsed = myOpenTeamRows.safeParse(data);
  if (!parsed.success) throw new Error("collab_read_failed");

  const first = parsed.data[0];
  if (!first) return null;

  return {
    teamId: first.team_id,
    teamName: first.team_name,
  };
}

export async function readTeamMates(
  client: CollabClient,
  teamId: string,
  decryptName: (value: string, profileId: string) => Promise<string>,
): Promise<readonly TeamMate[]> {
  const { data, error } = await client.rpc("team_members", { p_team: teamId });
  if (error) throw new Error("collab_read_failed");

  const parsed = teamMemberRows.safeParse(data);
  if (!parsed.success) throw new Error("collab_read_failed");

  return Promise.all(
    parsed.data.map(async (row) => {
      const displayName = await decryptName(row.display_name_enc, row.profile_id).catch(
        (decryptError: unknown) => {
          log.warn("collab_unreadable", { error: String(decryptError) });
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

export async function readChat(
  client: CollabClient,
  teamId: string,
  decryptName: (value: string, profileId: string) => Promise<string>,
  decryptBody: (value: string, teamId: string) => Promise<string>,
): Promise<readonly ChatMessage[]> {
  const { data, error } = await client.rpc("team_messages_for", {
    p_team: teamId,
    p_limit: 50,
  });

  if (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      String((error as { readonly code?: unknown }).code) === "42501"
    ) {
      return [];
    }
    throw new Error("collab_read_failed");
  }

  const parsed = teamMessageRows.safeParse(data);
  if (!parsed.success) throw new Error("collab_read_failed");

  return Promise.all(
    parsed.data.map(async (row) => {
      const [authorName, body] = await Promise.all([
        decryptName(row.author_name_enc, row.author_id).catch((decryptError: unknown) => {
          log.warn("collab_unreadable", { error: String(decryptError) });
          return "—";
        }),
        decryptBody(row.body_enc, teamId).catch((decryptError: unknown) => {
          log.warn("collab_unreadable", { error: String(decryptError) });
          return "—";
        }),
      ]);

      return {
        messageId: row.message_id,
        authorName,
        body,
        createdAt: row.created_at,
        isMine: row.is_mine,
      };
    }),
  );
}

export async function postMessage(
  client: CollabClient,
  input: unknown,
  encryptBody: (body: string, teamId: string) => Promise<string>,
): Promise<CollabResult> {
  const parsed = postMessageSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };

  const encryptedBody = await encryptBody(parsed.data.body, parsed.data.teamId);

  const { error } = await client.rpc("post_team_message", {
    p_team: parsed.data.teamId,
    p_body_enc: encryptedBody,
  });

  if (error) return { ok: false, error: mapCollabError(error) };
  return { ok: true };
}

export async function readDashboard(client: CollabClient): Promise<readonly DashboardRow[]> {
  const { data, error } = await client.rpc("team_dashboard");
  if (error) throw new Error("collab_read_failed");

  const parsed = dashboardRowsSchema.safeParse(data);
  if (!parsed.success) throw new Error("collab_read_failed");

  return parsed.data.map((row) => ({
    teamId: row.team_id,
    teamName: row.team_name,
    memberCount: row.member_count,
    activeRuns: row.active_runs,
    completedRuns: row.completed_runs,
    teamPoints: row.team_points,
  }));
}

export async function submitEvaluation(
  client: CollabClient,
  input: unknown,
  encrypt: (
    value: string,
    column: "grade_enc" | "note_enc",
    profileId: string,
  ) => Promise<string>,
  today: string,
): Promise<CollabResult> {
  const parsed = submitEvaluationSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };

  const gradeEnc = await encrypt(parsed.data.grade, "grade_enc", parsed.data.profileId);
  const noteEnc =
    parsed.data.note && parsed.data.note.length > 0
      ? await encrypt(parsed.data.note, "note_enc", parsed.data.profileId)
      : null;

  const { error } = await client.rpc("submit_evaluation", {
    p_profile: parsed.data.profileId,
    p_axis: "team",
    p_grade_enc: gradeEnc,
    p_note_enc: noteEnc,
    p_cycle_ends_on: today,
  });

  if (error) return { ok: false, error: mapCollabError(error) };
  return { ok: true };
}
