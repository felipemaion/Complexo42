import type { InstanceConfig } from "@/modules/instance";

// Contratos do módulo de missões (ADR 0006). Os valores das uniões são as chaves do banco
// (supabase/migrations/20261121000000_missions.sql); o texto exibido vem de config/ (R17).

export type MissionOrigin = "national" | "regional";
export type MissionMode = "team" | "individual";
export type RunStatus = "active" | "completed" | "abandoned";
export type EvidenceType = "none" | "link" | "protocol_number" | "text";
export type SubmissionStatus = "submitted" | "approved" | "rejected";
export type StepState = "locked" | "open" | "pending" | "approved" | "rejected";

export type MissionSummary = {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly category: string;
  readonly origin: MissionOrigin;
  readonly mode: MissionMode;
};

export type MissionListItem = MissionSummary & { readonly totalPoints: number };

export type MissionStep = {
  readonly id: string;
  readonly position: number;
  readonly title: string;
  readonly description: string;
  readonly points: number;
  readonly evidenceType: EvidenceType;
  readonly requiresPrevious: boolean;
};

export type MissionRun = {
  readonly id: string;
  readonly missionId: string;
  readonly status: RunStatus;
};

export type StepSubmission = {
  readonly id: string;
  readonly stepId: string;
  readonly status: SubmissionStatus;
  readonly reviewNote: string | null;
  readonly createdAt: string;
};

export type PendingReview = {
  readonly submissionId: string;
  readonly missionTitle: string;
  readonly stepTitle: string;
  readonly stepPoints: number;
  readonly evidenceType: EvidenceType;
  readonly evidenceUrl: string | null;
  readonly evidenceText: string | null;
  readonly unitName: string;
  readonly submittedAt: string;
};

export type PublishableUnit = { readonly id: string; readonly name: string; readonly depth: number };

/** Textos das telas de missões (config/instance.ts, R17). */
export type MissionsText = InstanceConfig["missions"];

/** Motivo de recusa mostrado na tela (texto em `missions.errors` da config). */
export type MissionErrorCode = "not_allowed" | "invalid_evidence" | "locked" | "already_done" | "unavailable" | "failed";

export type MissionActionResult<T = undefined> =
  | ({ ok: true } & (T extends undefined ? object : { value: T }))
  | { ok: false; error: MissionErrorCode };

/**
 * O subconjunto do cliente do Supabase que este módulo usa: o cliente do servidor com o JWT de
 * quem está logado (R14), para a RLS e as funções do banco valerem. Nunca `service_role`.
 */
export type MissionQuery = PromiseLike<{ data: unknown; error: unknown }> & {
  eq(column: string, value: string): MissionQuery;
  is(column: string, value: null): MissionQuery;
  order(column: string, options: { ascending: boolean }): MissionQuery;
  maybeSingle(): PromiseLike<{ data: unknown; error: unknown }>;
};

export type MissionClient = {
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
  from(table: string): { select(columns: string): MissionQuery };
};
