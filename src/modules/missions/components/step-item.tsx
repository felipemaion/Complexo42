import { buttonClass, inputClass, labelClass, Tag, type TagTone } from "@/modules/ui";
import type { StepProgress } from "../domain/progress";
import type { MissionsText, StepState } from "../types";

type StepItemProps = {
  readonly progress: StepProgress;
  readonly missionId: string;
  readonly runId: string | null;
  readonly text: MissionsText;
  readonly submitAction: (formData: FormData) => Promise<void>;
};

const stateTone: Record<StepState, TagTone> = {
  locked: "neutral",
  open: "primary",
  pending: "warning",
  approved: "success",
  rejected: "danger",
};

// Uma etapa da missão. O formulário de entrega só aparece quando a etapa está aberta; o tipo
// de comprovante pedido decide o campo (ADR 0006 §3 e §7). Sem upload de arquivo.
export function StepItem({ progress, missionId, runId, text, submitAction }: StepItemProps) {
  const { step, state, latest } = progress;
  const canSubmit = runId !== null && (state === "open" || state === "rejected");
  const fieldId = `evidencia-${step.id}`;
  return (
    <li className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-lg font-bold text-ink-muted">{step.position}.</span>
        <Tag tone={stateTone[state]}>{text.stepState[state]}</Tag>
        <Tag>
          {step.points} {text.pointsSuffix}
        </Tag>
      </div>
      <h3 className="text-xl font-bold text-ink">{step.title}</h3>
      {step.description && <p className="text-lg text-ink-muted">{step.description}</p>}
      {state === "rejected" && latest?.reviewNote && (
        <p className="rounded-xl border-l-4 border-danger bg-danger-soft p-4 text-lg">
          <strong>{text.reviewNoteLabel}:</strong> {latest.reviewNote}
        </p>
      )}
      {canSubmit && (
        <form action={submitAction} className="flex flex-col gap-3">
          <input type="hidden" name="missionId" value={missionId} />
          <input type="hidden" name="runId" value={runId} />
          <input type="hidden" name="stepId" value={step.id} />
          {step.evidenceType === "none" && <p className="text-lg text-ink-muted">{text.evidence.none}</p>}
          {step.evidenceType === "link" && (
            <>
              <label htmlFor={fieldId} className={labelClass}>
                {text.evidence.link}
              </label>
              <input id={fieldId} name="url" type="url" inputMode="url" required maxLength={500} pattern="https://.+" className={inputClass} />
            </>
          )}
          {step.evidenceType === "protocol_number" && (
            <>
              <label htmlFor={fieldId} className={labelClass}>
                {text.evidence.protocol_number}
              </label>
              <input id={fieldId} name="text" type="text" required maxLength={60} className={inputClass} />
            </>
          )}
          {step.evidenceType === "text" && (
            <>
              <label htmlFor={fieldId} className={labelClass}>
                {text.evidence.text}
              </label>
              <textarea id={fieldId} name="text" required maxLength={500} rows={4} aria-describedby={`${fieldId}-aviso`} className={`${inputClass} min-h-32`} />
              <p id={`${fieldId}-aviso`} className="text-base text-ink-muted">
                {text.evidenceWarning}
              </p>
            </>
          )}
          <button type="submit" className={buttonClass("primary")}>
            {text.submitButton}
          </button>
        </form>
      )}
    </li>
  );
}
