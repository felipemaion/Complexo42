"use client";
// Pedido auditado de leitura de avaliação (ADR 0007 §4). O resultado aparece só nesta tela,
// na resposta do próprio pedido; nada fica guardado no navegador.
import { useActionState } from "react";
import type { InstanceConfig } from "@/modules/instance";
import { buttonClass, inputClass, labelClass, Notice } from "@/modules/ui";

export type EvaluationAccessState =
  | { readonly status: "idle" }
  | { readonly status: "error"; readonly error: "not_allowed" | "invalid" | "failed" }
  | {
      readonly status: "ok";
      readonly rows: readonly { readonly axis: string; readonly grade: string; readonly note: string | null; readonly cycleEndsOn: string }[];
    };

type Props = {
  readonly people: readonly { readonly profileId: string; readonly displayName: string }[];
  readonly text: InstanceConfig["evaluationAccess"];
  readonly grades: InstanceConfig["evaluations"]["grades"];
  readonly accessAction: (state: EvaluationAccessState, formData: FormData) => Promise<EvaluationAccessState>;
};

const isGrade = (value: string, grades: Props["grades"]): value is keyof Props["grades"] => value in grades;

export function EvaluationAccess({ people, text, grades, accessAction }: Props) {
  const [state, formAction, pending] = useActionState(accessAction, { status: "idle" });
  return (
    <div className="flex flex-col gap-3">
      <p className="text-lg text-ink-muted">{text.intro}</p>
      <form action={formAction} className="flex flex-col gap-3">
        <label htmlFor="acesso-pessoa" className={labelClass}>
          {text.personLabel}
        </label>
        <select id="acesso-pessoa" name="profileId" required className={inputClass}>
          {people.map((person) => (
            <option key={person.profileId} value={person.profileId}>
              {person.displayName}
            </option>
          ))}
        </select>
        <label htmlFor="acesso-motivo" className={labelClass}>
          {text.reasonLabel}
        </label>
        <textarea id="acesso-motivo" name="reason" required minLength={10} maxLength={300} rows={3} className={`${inputClass} min-h-24`} />
        <button type="submit" disabled={pending} className={buttonClass("secondary")}>
          {text.button}
        </button>
      </form>
      {state.status === "error" && <Notice tone="error">{text.errors[state.error]}</Notice>}
      {state.status === "ok" && state.rows.length === 0 && <Notice tone="info">{text.none}</Notice>}
      {state.status === "ok" && state.rows.length > 0 && (
        <ul className="flex flex-col gap-2">
          {state.rows.map((row) => (
            <li key={`${row.cycleEndsOn}-${row.axis}-${row.grade}`} className="rounded-xl border border-line bg-surface p-3 text-lg">
              <strong>{isGrade(row.grade, grades) ? grades[row.grade] : row.grade}</strong> · {row.cycleEndsOn}
              {row.note && <p className="text-ink-muted">{row.note}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
