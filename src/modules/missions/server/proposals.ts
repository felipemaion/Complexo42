import "server-only";
import { z } from "zod";

// Propostas de missão pela equipe (#57, ADR 0006 §5). A equipe propõe; a coordenação do escopo
// ajusta os pontos e publica, ou recusa com justificativa. Quem pode o banco decide.

export type ProposalClient = {
  readonly rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{ readonly data: unknown; readonly error: unknown }>;
};
export type ProposalError = "invalid" | "not_allowed" | "too_many" | "failed";
export type ProposalResult = { readonly ok: true } | { readonly ok: false; readonly error: ProposalError };

export type MyProposal = { readonly id: string; readonly title: string; readonly status: "proposed" | "published" | "archived"; readonly decisionNote: string | null };
export type PendingProposal = {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly category: string;
  readonly teamId: string;
  readonly teamName: string;
  readonly parentId: string | null;
  readonly steps: readonly { readonly position: number; readonly title: string; readonly points: number; readonly evidenceType: string }[];
};

const evidenceType = z.enum(["none", "link", "protocol_number", "text"]);

function mapError(error: unknown): ProposalError {
  const code = typeof error === "object" && error !== null && "code" in error ? String((error as { code: unknown }).code) : "";
  if (code === "42501") return "not_allowed";
  if (code === "22023") return "invalid";
  if (code === "C7614") return "too_many";
  return "failed";
}

export async function proposeMission(client: ProposalClient, input: unknown, categoryKeys: readonly string[]): Promise<ProposalResult> {
  const parsed = z
    .object({
      title: z.string().trim().min(3).max(120),
      description: z.string().trim().max(2000),
      category: z.string().refine((key) => categoryKeys.includes(key)),
      steps: z
        .array(z.object({ title: z.string().trim().min(3).max(120), points: z.coerce.number().int().min(1).max(1000), evidenceType }))
        .min(1)
        .max(3),
    })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const { error } = await client.rpc("propose_mission", {
    p_title: parsed.data.title,
    p_description: parsed.data.description,
    p_category: parsed.data.category,
    p_steps: parsed.data.steps.map((step) => ({ title: step.title, points: step.points, evidence_type: step.evidenceType })),
  });
  return error ? { ok: false, error: mapError(error) } : { ok: true };
}

export async function decideProposal(client: ProposalClient, input: unknown): Promise<ProposalResult> {
  const parsed = z
    .object({
      missionId: z.guid(),
      decision: z.enum(["approve", "reject"]),
      scopeUnitId: z.preprocess((v) => (v === "" ? undefined : v), z.guid().optional()),
      points: z.array(z.coerce.number().int().min(1).max(1000)).max(3),
      note: z.string().trim().max(300),
    })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const approve = parsed.data.decision === "approve";
  if (!approve && parsed.data.note.length < 3) return { ok: false, error: "invalid" };
  const { error } = await client.rpc("decide_proposal", {
    p_mission: parsed.data.missionId,
    p_approve: approve,
    p_scope_unit: approve ? (parsed.data.scopeUnitId ?? null) : null,
    p_points: approve && parsed.data.points.length > 0 ? parsed.data.points : null,
    p_note: parsed.data.note === "" ? null : parsed.data.note,
  });
  return error ? { ok: false, error: mapError(error) } : { ok: true };
}

export async function readMyProposals(client: ProposalClient): Promise<readonly MyProposal[]> {
  const { data, error } = await client.rpc("my_team_proposals", {});
  if (error) throw new Error("proposals_read_failed");
  return z
    .array(z.object({ id: z.guid(), title: z.string(), status: z.enum(["proposed", "published", "archived"]), decision_note: z.string().nullable() }))
    .parse(data)
    .map((row) => ({ id: row.id, title: row.title, status: row.status, decisionNote: row.decision_note }));
}

export async function readPendingProposals(client: ProposalClient): Promise<readonly PendingProposal[]> {
  const { data, error } = await client.rpc("pending_proposals", {});
  if (error) throw new Error("proposals_read_failed");
  return z
    .array(
      z.object({
        id: z.guid(),
        title: z.string(),
        description: z.string(),
        category: z.string(),
        team_id: z.guid(),
        team_name: z.string(),
        parent_id: z.guid().nullable(),
        steps: z.array(z.object({ position: z.number(), title: z.string(), points: z.number(), evidence_type: z.string() })).nullable(),
      }),
    )
    .parse(data)
    .map((row) => ({
      id: row.id,
      title: row.title,
      description: row.description,
      category: row.category,
      teamId: row.team_id,
      teamName: row.team_name,
      parentId: row.parent_id,
      steps: (row.steps ?? []).map((s) => ({ position: s.position, title: s.title, points: s.points, evidenceType: s.evidence_type })),
    }));
}
