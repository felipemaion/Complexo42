// Draft do 2º ciclo (ata de 17/11 §6) e pedido auditado de acesso à avaliação (ADR 0007 §4).
// O banco decide a vez, o trecho da lista e quem pode (R15); aqui só validamos a entrada.
import "server-only";
import { z } from "zod";
import { log } from "@/server/log";
import type { CollabClient, CollabResult } from "../types";

export type DraftState = {
  readonly sessionId: string;
  readonly teamOnTurnName: string;
  readonly isMyTurn: boolean;
  readonly picksMade: number;
};
export type DraftOption = { readonly profileId: string; readonly displayName: string };
type Decrypt = (value: string, profileId: string) => Promise<string>;

const codeOf = (error: unknown): string | undefined =>
  typeof error === "object" && error !== null && typeof (error as { code?: unknown }).code === "string"
    ? (error as { code: string }).code
    : undefined;

function toResult(error: unknown): CollabResult {
  if (!error) return { ok: true };
  const code = codeOf(error);
  return { ok: false, error: code === "42501" ? "not_allowed" : code === "22023" ? "invalid" : "failed" };
}

const stateRows = z.array(
  z.object({ session_id: z.string(), team_on_turn_name: z.string(), is_my_turn: z.boolean(), picks_made: z.number().int() }),
);

export async function readDraftState(client: CollabClient): Promise<DraftState | null> {
  const { data, error } = await client.rpc("draft_state");
  if (error) throw new Error("draft_read_failed");
  const [row] = stateRows.parse(data);
  return row
    ? { sessionId: row.session_id, teamOnTurnName: row.team_on_turn_name, isMyTurn: row.is_my_turn, picksMade: row.picks_made }
    : null;
}

const optionRows = z.array(z.object({ profile_id: z.string(), display_name_enc: z.string() }));

export async function readDraftOptions(client: CollabClient, sessionId: string, decrypt: Decrypt): Promise<readonly DraftOption[]> {
  const { data, error } = await client.rpc("draft_options", { p_session: z.guid().parse(sessionId) });
  if (error) throw new Error("draft_read_failed");
  return Promise.all(
    optionRows.parse(data).map(async (row) => ({
      profileId: row.profile_id,
      displayName: await decrypt(row.display_name_enc, row.profile_id).catch(() => {
        log.warn("collab_unreadable");
        return "—";
      }),
    })),
  );
}

export async function openDraft(client: CollabClient, input: unknown): Promise<CollabResult> {
  const parsed = z
    .strictObject({ parentId: z.guid(), teamIds: z.array(z.guid()).min(2).max(50), sliceSize: z.coerce.number().int().min(1).max(20) })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const { error } = await client.rpc("open_draft", {
    p_parent: parsed.data.parentId,
    p_team_order: parsed.data.teamIds,
    p_slice_size: parsed.data.sliceSize,
  });
  return toResult(error);
}

export async function pickInDraft(client: CollabClient, input: unknown): Promise<CollabResult> {
  const parsed = z.strictObject({ sessionId: z.guid(), profileId: z.guid() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const { error } = await client.rpc("draft_pick", { p_session: parsed.data.sessionId, p_profile: parsed.data.profileId });
  return toResult(error);
}

export async function closeDraft(client: CollabClient, input: unknown): Promise<CollabResult> {
  const parsed = z.strictObject({ sessionId: z.guid() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const { error } = await client.rpc("close_draft", { p_session: parsed.data.sessionId });
  return toResult(error);
}

export type RevealedEvaluation = { readonly axis: string; readonly grade: string; readonly note: string | null; readonly cycleEndsOn: string };

const evaluationRows = z.array(
  z.object({ axis: z.string(), grade_enc: z.string(), note_enc: z.string().nullable(), cycle_ends_on: z.string() }),
);

/** Lê as avaliações de alguém com motivo obrigatório; o banco registra o pedido na auditoria. */
export async function requestEvaluationAccess(
  client: CollabClient,
  input: unknown,
  decrypt: (value: string, column: "grade_enc" | "note_enc", profileId: string) => Promise<string>,
): Promise<{ ok: true; value: readonly RevealedEvaluation[] } | { ok: false; error: "not_allowed" | "invalid" | "failed" }> {
  const parsed = z.strictObject({ profileId: z.guid(), reason: z.string().trim().min(10).max(300) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const { data, error } = await client.rpc("request_evaluation_access", { p_profile: parsed.data.profileId, p_reason: parsed.data.reason });
  if (error) {
    const result = toResult(error);
    return result.ok ? { ok: false, error: "failed" } : { ok: false, error: result.error === "too_many" ? "failed" : result.error };
  }
  const id = parsed.data.profileId;
  const value = await Promise.all(
    evaluationRows.parse(data).map(async (row) => ({
      axis: row.axis,
      grade: await decrypt(row.grade_enc, "grade_enc", id),
      note: row.note_enc ? await decrypt(row.note_enc, "note_enc", id) : null,
      cycleEndsOn: row.cycle_ends_on,
    })),
  );
  return { ok: true, value };
}
