import { buttonClass, inputClass, labelClass } from "@/modules/ui";
import type { TeamParent, TeamsText } from "../types";

type Props = {
  readonly parents: readonly TeamParent[];
  readonly text: TeamsText;
  readonly createAction: (formData: FormData) => Promise<void>;
};

export function CreateTeamForm({ parents, text, createAction }: Props) {
  return (
    <form action={createAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <label htmlFor="create-team-parent" className={labelClass}>
          {text.parentLabel}
        </label>
        <select
          id="create-team-parent"
          name="parentId"
          className={inputClass}
          required
          defaultValue={parents[0]?.id ?? ""}
        >
          {parents.map((parent) => (
            <option key={parent.id} value={parent.id}>
              {"— ".repeat(Math.max(0, parent.depth - 1)) + parent.name}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="create-team-name" className={labelClass}>
          {text.nameLabel}
        </label>
        <input
          id="create-team-name"
          name="name"
          type="text"
          required
          minLength={2}
          maxLength={60}
          className={inputClass}
        />
      </div>

      <button type="submit" className={buttonClass("primary")}>
        {text.createButton}
      </button>
    </form>
  );
}
