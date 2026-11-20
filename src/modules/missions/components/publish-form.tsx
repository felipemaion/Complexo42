import { buttonClass, inputClass, labelClass } from "@/modules/ui";
import type { EvidenceType, MissionsText, PublishableUnit } from "../types";

type PublishFormProps = {
  readonly units: readonly PublishableUnit[];
  readonly text: MissionsText;
  readonly publishAction: (formData: FormData) => Promise<void>;
};

const stepNumbers = [1, 2, 3] as const;
const evidenceTypes: readonly EvidenceType[] = ["none", "link", "protocol_number", "text"];

// Formulário de publicação (ADR 0006 §3 e §5). Tudo numa tela só, sem passo escondido; a 1ª
// etapa é obrigatória e as outras duas são opcionais. O banco grava tudo de uma vez.
export function PublishForm({ units, text, publishAction }: PublishFormProps) {
  const t = text.publish;
  return (
    <form action={publishAction} className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <label htmlFor="titulo" className={labelClass}>
          {t.titleLabel}
        </label>
        <input id="titulo" name="title" required minLength={3} maxLength={120} className={inputClass} />
      </div>
      <div className="flex flex-col gap-2">
        <label htmlFor="descricao" className={labelClass}>
          {t.descriptionLabel}
        </label>
        <textarea id="descricao" name="description" maxLength={2000} rows={4} className={`${inputClass} min-h-32`} />
      </div>
      <div className="flex flex-col gap-2">
        <label htmlFor="tipo" className={labelClass}>
          {t.categoryLabel}
        </label>
        <select id="tipo" name="category" required className={inputClass}>
          {Object.entries(t.categories).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-2">
        <label htmlFor="escopo" className={labelClass}>
          {t.scopeLabel}
        </label>
        <select id="escopo" name="scopeUnitId" required className={inputClass}>
          {units.map((unit) => (
            <option key={unit.id} value={unit.id}>
              {`${"— ".repeat(Math.max(0, unit.depth - 1))}${unit.name}`}
            </option>
          ))}
        </select>
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className={labelClass}>{t.modeLabel}</legend>
        {(["team", "individual"] as const).map((mode, index) => (
          <label key={mode} className="flex min-h-14 items-center gap-3 rounded-xl border-2 border-line bg-surface px-4 text-lg">
            <input type="radio" name="mode" value={mode} defaultChecked={index === 0} className="h-6 w-6 accent-primary" />
            {text.mode[mode]}
          </label>
        ))}
      </fieldset>
      <fieldset className="flex flex-col gap-4">
        <legend className={`${labelClass} mb-2`}>{t.stepsLegend}</legend>
        {stepNumbers.map((n) => (
          <div key={n} className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4">
            <p className="text-lg font-bold text-ink-muted">{n}.</p>
            <label htmlFor={`etapa-${n}-titulo`} className={labelClass}>
              {t.stepTitleLabel}
            </label>
            <input id={`etapa-${n}-titulo`} name={`step${n}Title`} required={n === 1} maxLength={120} className={inputClass} />
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <label htmlFor={`etapa-${n}-pontos`} className={labelClass}>
                  {t.stepPointsLabel}
                </label>
                <input
                  id={`etapa-${n}-pontos`}
                  name={`step${n}Points`}
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={1000}
                  defaultValue={n === 1 ? 10 : undefined}
                  required={n === 1}
                  className={inputClass}
                />
              </div>
              <div className="flex flex-col gap-2">
                <label htmlFor={`etapa-${n}-comprovante`} className={labelClass}>
                  {t.stepEvidenceLabel}
                </label>
                <select id={`etapa-${n}-comprovante`} name={`step${n}Evidence`} className={inputClass}>
                  {evidenceTypes.map((type) => (
                    <option key={type} value={type}>
                      {t.evidenceOptions[type]}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        ))}
      </fieldset>
      <button type="submit" className={buttonClass("primary")}>
        {t.publishButton}
      </button>
    </form>
  );
}
