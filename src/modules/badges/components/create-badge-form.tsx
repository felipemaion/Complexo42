import { buttonClass } from "@/modules/ui";
import { inputClass, labelClass } from "@/modules/ui";
import { badgeEmoji } from "../domain/icons";
import { BADGE_ICONS, type BadgesText } from "../types";

type ScopeUnit = {
  readonly id: string;
  readonly name: string;
  readonly depth: number;
};

type CreateBadgeFormProps = {
  readonly scopes: readonly ScopeUnit[];
  readonly text: BadgesText;
  readonly createAction: (formData: FormData) => Promise<void>;
};

export function CreateBadgeForm({ scopes, text, createAction }: CreateBadgeFormProps) {
  return (
    <form action={createAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <label htmlFor="scopeUnitId" className={labelClass}>
          {text.scopeLabel}
        </label>
        <select id="scopeUnitId" name="scopeUnitId" required className={inputClass}>
          {scopes.map((scope) => (
            <option key={scope.id} value={scope.id}>
              {scope.name}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="name" className={labelClass}>
          {text.nameLabel}
        </label>
        <input
          id="name"
          name="name"
          type="text"
          required
          minLength={2}
          maxLength={60}
          className={inputClass}
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="description" className={labelClass}>
          {text.descriptionLabel}
        </label>
        <input
          id="description"
          name="description"
          type="text"
          maxLength={300}
          className={inputClass}
        />
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className={labelClass}>{text.iconLabel}</legend>
        <div className="flex flex-wrap gap-4">
          {BADGE_ICONS.map((icon, index) => (
            <label key={icon} className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="icon"
                value={icon}
                defaultChecked={index === 0}
                required
              />
              <span aria-hidden="true">{badgeEmoji(icon)}</span>
              <span>{icon}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <button type="submit" className={buttonClass("primary")}>
        {text.createButton}
      </button>
    </form>
  );
}
