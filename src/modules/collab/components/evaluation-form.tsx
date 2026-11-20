import { buttonClass, inputClass, labelClass } from "@/modules/ui";
import type { InstanceConfig } from "@/modules/instance";

type EvaluationFormProps = {
  readonly profileId: string;
  readonly text: InstanceConfig["evaluations"];
  readonly evaluateAction: (formData: FormData) => void | Promise<void>;
};

export function EvaluationForm({
  profileId,
  text,
  evaluateAction,
}: EvaluationFormProps) {
  return (
    <details>
      <summary className={buttonClass("secondary", { isFullWidth: false })}>
        {text.title}
      </summary>
      <form action={evaluateAction} className="flex flex-col gap-3 mt-3">
        <input type="hidden" name="profileId" value={profileId} />
        <fieldset className="flex flex-col gap-2">
          <legend className={labelClass}>{text.gradeLabel}</legend>
          <div className="flex gap-4">
            <label className="flex items-center gap-1">
              <input type="radio" name="grade" value="bronze" required />
              <span>{text.grades.bronze}</span>
            </label>
            <label className="flex items-center gap-1">
              <input type="radio" name="grade" value="prata" required />
              <span>{text.grades.prata}</span>
            </label>
            <label className="flex items-center gap-1">
              <input type="radio" name="grade" value="ouro" required />
              <span>{text.grades.ouro}</span>
            </label>
          </div>
        </fieldset>

        <label htmlFor={`note-${profileId}`} className={labelClass}>
          {text.noteLabel}
        </label>
        <textarea
          id={`note-${profileId}`}
          name="note"
          maxLength={500}
          className={`${inputClass} min-h-20`}
        />

        <div>
          <button type="submit" className={buttonClass("primary")}>
            {text.submitButton}
          </button>
        </div>
      </form>
    </details>
  );
}
