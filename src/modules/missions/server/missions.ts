// Missões no servidor (ADR 0006). Tudo com o cliente do JWT de quem está logado (R14): a RLS
// decide o que volta e as funções do banco decidem o que pode ser feito (R15). Toda entrada
// do navegador passa por Zod aqui.
import "server-only";
import { z } from "zod";
import { normalizeEvidence, sumLedger } from "../domain/progress";
import type {
  MissionActionResult,
  MissionClient,
  MissionErrorCode,
  MissionRun,
  MissionStep,
  MissionSummary,
  PendingReview,
  PublishableUnit,
  StepSubmission,
} from "../types";

/** Código do Postgres/PostgREST → motivo exibido (migration 20261121000000, regra 7). */
const errorByCode: Record<string, MissionErrorCode> = {
  "42501": "not_allowed",
  "22023": "invalid_evidence",
  C7611: "locked",
  C7612: "already_done",
  C7613: "unavailable",
  P0002: "unavailable",
};

function errorCode(error: unknown): MissionErrorCode {
  const code = typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;
  return (typeof code === "string" && errorByCode[code]) || "failed";
}

const id = z.guid();
const evidenceType = z.enum(["none", "link", "protocol_number", "text"]);

const missionRow = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  category: z.string(),
  origin: z.enum(["national", "regional"]),
  mode: z.enum(["team", "individual"]),
});
const toSummary = (row: z.infer<typeof missionRow>): MissionSummary => ({ ...row });

const stepRow = z.object({
  id: z.string(),
  position: z.number().int(),
  title: z.string(),
  description: z.string(),
  points: z.number().int(),
  evidence_type: evidenceType,
  requires_previous: z.boolean(),
});
const toStep = (row: z.infer<typeof stepRow>): MissionStep => ({
  id: row.id,
  position: row.position,
  title: row.title,
  description: row.description,
  points: row.points,
  evidenceType: row.evidence_type,
  requiresPrevious: row.requires_previous,
});

/** Missões publicadas que quem está logado enxerga (a RLS filtra pelo escopo). */
export async function listMissions(client: MissionClient): Promise<readonly MissionSummary[]> {
  const { data, error } = await client
    .from("missions")
    .select("id, title, description, category, origin, mode")
    .eq("status", "published")
    .order("created_at", { ascending: false });
  if (error) throw new Error(`missions_read_failed:${errorCode(error)}`);
  return z.array(missionRow).parse(data).map(toSummary);
}

/** A missão publicada e as etapas em ordem, ou null se não existe ou não está no escopo. */
export async function readMission(
  client: MissionClient,
  missionId: unknown,
): Promise<{ mission: MissionSummary; steps: readonly MissionStep[] } | null> {
  const parsedId = id.safeParse(missionId);
  if (!parsedId.success) return null;
  const { data, error } = await client
    .from("missions")
    .select("id, title, description, category, origin, mode")
    .eq("id", parsedId.data)
    .eq("status", "published")
    .maybeSingle();
  if (error) throw new Error(`mission_read_failed:${errorCode(error)}`);
  const mission = missionRow.nullable().parse(data);
  if (!mission) return null;
  const steps = await client
    .from("mission_steps")
    .select("id, position, title, description, points, evidence_type, requires_previous")
    .eq("mission_id", mission.id)
    .order("position", { ascending: true });
  if (steps.error) throw new Error(`steps_read_failed:${errorCode(steps.error)}`);
  return { mission: toSummary(mission), steps: z.array(stepRow).parse(steps.data).map(toStep) };
}

const runRow = z.object({ run: z.object({ id: z.string(), mission_id: z.string(), status: z.enum(["active", "completed", "abandoned"]) }) });

/** As execuções de que a pessoa participa, por missão (a ativa vence a concluída). */
export async function readMyRuns(client: MissionClient, userId: string): Promise<ReadonlyMap<string, MissionRun>> {
  const { data, error } = await client
    .from("mission_run_members")
    .select("run:mission_runs!inner(id, mission_id, status)")
    .eq("profile_id", id.parse(userId));
  if (error) throw new Error(`runs_read_failed:${errorCode(error)}`);
  const runs = z.array(runRow).parse(data).map(({ run }): MissionRun => ({ id: run.id, missionId: run.mission_id, status: run.status }));
  return runs.reduce((byMission, run) => {
    const current = byMission.get(run.missionId);
    const isBetter = !current || (current.status !== "active" && run.status === "active");
    return isBetter ? new Map(byMission).set(run.missionId, run) : byMission;
  }, new Map<string, MissionRun>());
}

const submissionRow = z.object({
  id: z.string(),
  step_id: z.string(),
  status: z.enum(["submitted", "approved", "rejected"]),
  review_note: z.string().nullable(),
  created_at: z.string(),
});

export async function readSubmissions(client: MissionClient, runId: string): Promise<readonly StepSubmission[]> {
  const { data, error } = await client
    .from("step_submissions")
    .select("id, step_id, status, review_note, created_at")
    .eq("run_id", id.parse(runId))
    .order("created_at", { ascending: true });
  if (error) throw new Error(`submissions_read_failed:${errorCode(error)}`);
  return z.array(submissionRow).parse(data).map((row) => ({
    id: row.id,
    stepId: row.step_id,
    status: row.status,
    reviewNote: row.review_note,
    createdAt: row.created_at,
  }));
}

const pointsRows = z.array(z.object({ points: z.number().int() }));

/** Saldo da pessoa e da equipe dela (ADR 0006 §6: cada um vê os próprios pontos). */
export async function readPoints(client: MissionClient, userId: string): Promise<{ mine: number; team: number }> {
  const [mine, team] = await Promise.all([
    client.from("points_ledger").select("points").eq("profile_id", id.parse(userId)),
    // Lançamentos de unidade (sem pessoa) que a RLS mostra: os da equipe de quem pergunta.
    client.from("points_ledger").select("points").is("profile_id", null),
  ]);
  if (mine.error || team.error) throw new Error("points_read_failed");
  return { mine: sumLedger(pointsRows.parse(mine.data)), team: sumLedger(pointsRows.parse(team.data)) };
}

export async function startRun(client: MissionClient, missionId: unknown): Promise<MissionActionResult<string>> {
  const parsed = id.safeParse(missionId);
  if (!parsed.success) return { ok: false, error: "unavailable" };
  const { data, error } = await client.rpc("start_mission_run", { p_mission: parsed.data });
  if (error) return { ok: false, error: errorCode(error) };
  const runId = id.safeParse(data);
  return runId.success ? { ok: true, value: runId.data } : { ok: false, error: "failed" };
}

/** Entrega uma etapa. O tipo de evidência vem do banco (etapa lida no servidor), nunca do navegador. */
export async function submitStep(
  client: MissionClient,
  input: { readonly runId: unknown; readonly step: MissionStep; readonly url: unknown; readonly text: unknown },
): Promise<MissionActionResult> {
  const runId = id.safeParse(input.runId);
  if (!runId.success) return { ok: false, error: "unavailable" };
  const evidence = normalizeEvidence(input.step.evidenceType, { url: input.url, text: input.text });
  if (!evidence) return { ok: false, error: "invalid_evidence" };
  const { error } = await client.rpc("submit_step", {
    p_run: runId.data,
    p_step: input.step.id,
    p_evidence_url: evidence.url,
    p_evidence_text: evidence.text,
  });
  return error ? { ok: false, error: errorCode(error) } : { ok: true };
}

const reviewRow = z.object({
  submission_id: z.string(),
  mission_title: z.string(),
  step_title: z.string(),
  step_points: z.number().int(),
  evidence_type: evidenceType,
  evidence_url: z.string().nullable(),
  evidence_text: z.string().nullable(),
  unit_name: z.string(),
  submitted_at: z.string(),
});

/** Entregas que quem está logado pode validar (o banco já tira as de quem participou). */
export async function readPendingReviews(client: MissionClient): Promise<readonly PendingReview[]> {
  const { data, error } = await client.rpc("pending_reviews");
  if (error) throw new Error(`reviews_read_failed:${errorCode(error)}`);
  return z.array(reviewRow).parse(data).map((row) => ({
    submissionId: row.submission_id,
    missionTitle: row.mission_title,
    stepTitle: row.step_title,
    stepPoints: row.step_points,
    evidenceType: row.evidence_type,
    evidenceUrl: row.evidence_url,
    evidenceText: row.evidence_text,
    unitName: row.unit_name,
    submittedAt: row.submitted_at,
  }));
}

const reviewInput = z.strictObject({
  submissionId: id,
  decision: z.enum(["approve", "reject"]),
  note: z.string().trim().max(500).optional(),
});

export async function reviewSubmission(client: MissionClient, input: unknown): Promise<MissionActionResult<"approved" | "rejected">> {
  const parsed = reviewInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "failed" };
  const isApproved = parsed.data.decision === "approve";
  const { error } = await client.rpc("review_submission", {
    p_submission: parsed.data.submissionId,
    p_approve: isApproved,
    p_note: parsed.data.note || null,
  });
  if (error) return { ok: false, error: errorCode(error) };
  return { ok: true, value: isApproved ? "approved" : "rejected" };
}

const unitRow = z.object({ id: z.string(), name: z.string(), depth: z.number().int() });

export async function readPublishableUnits(client: MissionClient): Promise<readonly PublishableUnit[]> {
  const { data, error } = await client.rpc("publishable_units");
  if (error) throw new Error(`units_read_failed:${errorCode(error)}`);
  return z.array(unitRow).parse(data);
}

const maxSteps = 3;
const maxStepPoints = 1000;

/** Valida o formulário de publicação: nome, tipo da config, unidade e 1 a 3 etapas com pontos. */
export function parsePublishInput(input: unknown, categoryKeys: readonly string[]) {
  return z
    .strictObject({
      title: z.string().trim().min(3).max(120),
      description: z.string().trim().max(2000),
      category: z.string().refine((key) => categoryKeys.includes(key)),
      scopeUnitId: id,
      mode: z.enum(["team", "individual"]),
      steps: z
        .array(
          z.strictObject({
            title: z.string().trim().min(3).max(120),
            points: z.coerce.number().int().min(1).max(maxStepPoints),
            evidenceType,
          }),
        )
        .min(1)
        .max(maxSteps),
    })
    .safeParse(input);
}

export async function publishMission(
  client: MissionClient,
  input: unknown,
  categoryKeys: readonly string[],
): Promise<MissionActionResult<string> | { ok: false; error: "invalid" }> {
  const parsed = parsePublishInput(input, categoryKeys);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const { data, error } = await client.rpc("publish_mission", {
    p_title: parsed.data.title,
    p_description: parsed.data.description,
    p_category: parsed.data.category,
    p_scope_unit: parsed.data.scopeUnitId,
    p_mode: parsed.data.mode,
    p_steps: parsed.data.steps.map((step) => ({ title: step.title, points: step.points, evidence_type: step.evidenceType })),
  });
  if (error) return { ok: false, error: errorCode(error) };
  const missionId = id.safeParse(data);
  return missionId.success ? { ok: true, value: missionId.data } : { ok: false, error: "failed" };
}
