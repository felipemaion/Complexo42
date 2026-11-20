// Regras puras do andamento de uma missão (ADR 0006 §3–§4). Espelham o banco para a tela
// explicar cada etapa; quem decide de verdade é `app.submit_step`/`app.approve_submission`.
import type { EvidenceType, MissionStep, StepState, StepSubmission } from "../types";

export type StepProgress = {
  readonly step: MissionStep;
  readonly state: StepState;
  /** A entrega mais recente da etapa (para mostrar o comentário de quem validou). */
  readonly latest: StepSubmission | null;
};

function latestOf(submissions: readonly StepSubmission[], stepId: string): StepSubmission | null {
  return submissions
    .filter((s) => s.stepId === stepId)
    .reduce<StepSubmission | null>((latest, s) => (latest === null || s.createdAt > latest.createdAt ? s : latest), null);
}

/** Estado de cada etapa, em ordem. Sem execução começada, tudo fica fechado. */
export function stepProgress(
  steps: readonly MissionStep[],
  submissions: readonly StepSubmission[],
  hasActiveRun: boolean,
): readonly StepProgress[] {
  const ordered = [...steps].sort((a, b) => a.position - b.position);
  const approved = new Set(submissions.filter((s) => s.status === "approved").map((s) => s.stepId));
  return ordered.map((step) => {
    const latest = latestOf(submissions, step.id);
    if (approved.has(step.id)) return { step, state: "approved", latest };
    if (latest?.status === "submitted") return { step, state: "pending", latest };
    const isBlocked =
      !hasActiveRun || (step.requiresPrevious && ordered.some((p) => p.position < step.position && !approved.has(p.id)));
    if (isBlocked) return { step, state: "locked", latest };
    return { step, state: latest?.status === "rejected" ? "rejected" : "open", latest };
  });
}

/** Soma dos pontos de todas as etapas (o que a missão vale). */
export function totalPoints(steps: readonly MissionStep[]): number {
  return steps.reduce((sum, step) => sum + step.points, 0);
}

/** Soma de lançamentos do livro-razão (positivos e correções negativas). */
export function sumLedger(rows: readonly { readonly points: number }[]): number {
  return rows.reduce((sum, row) => sum + row.points, 0);
}

// Mesmas regras de `app.submit_step` (ADR 0006 §7): link só https; protocolo de 3 a 60
// caracteres simples; texto de 1 a 500.
const httpsUrl = /^https:\/\/\S+$/;
const protocolNumber = /^[A-Za-z0-9./ -]{3,60}$/;
const evidenceTextMaxChars = 500;
const evidenceUrlMaxChars = 500;

export type EvidenceInput = { readonly url: string | null; readonly text: string | null };

/** Normaliza a evidência do formulário para o tipo pedido; null quando não serve. */
export function normalizeEvidence(type: EvidenceType, raw: { url?: unknown; text?: unknown }): EvidenceInput | null {
  const url = typeof raw.url === "string" ? raw.url.trim() : "";
  const text = typeof raw.text === "string" ? raw.text.trim() : "";
  if (type === "none") return { url: null, text: null };
  if (type === "link") return httpsUrl.test(url) && url.length <= evidenceUrlMaxChars ? { url, text: null } : null;
  if (type === "protocol_number") return protocolNumber.test(text) ? { url: null, text } : null;
  return text.length > 0 && text.length <= evidenceTextMaxChars ? { url: null, text } : null;
}
