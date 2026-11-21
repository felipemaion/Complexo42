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
  readonly missions?: readonly { readonly id: string; readonly title: string }[];
  readonly text: BadgesText;
  readonly createAction: (formData: FormData) => Promise<void>;
};

const RULES = ["manual", "event", "milestone", "points_threshold", "mission_completed"] as const;

export function CreateBadgeForm({ scopes, missions = [], text, createAction }: CreateBadgeFormProps) {
  const ruleText = { manual: text.ruleManual, event: text.ruleEvent, milestone: text.ruleMilestone, points_threshold: text.rulePoints, mission_completed: text.ruleMission };
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

      {/* Como se ganha (#36). Tudo à vista, sem esconder campos (ata 17/11 §10). */}
      <fieldset className="flex flex-col gap-2">
        <legend className={labelClass}>{text.ruleLabel}</legend>
        {RULES.map((rule, index) => (
          <label key={rule} className="flex min-h-12 cursor-pointer items-center gap-3 text-lg">
            <input type="radio" name="rule" value={rule} defaultChecked={index === 0} required className="h-6 w-6" />
            {ruleText[rule]}
          </label>
        ))}
      </fieldset>

      <div className="flex flex-col gap-1">
        <label htmlFor="points" className={labelClass}>
          {text.pointsLabel}
        </label>
        <input id="points" name="points" type="number" min={1} max={100000} inputMode="numeric" className={inputClass} />
      </div>

      {missions.length > 0 && (
        <div className="flex flex-col gap-1">
          <label htmlFor="missionId" className={labelClass}>
            {text.missionLabel}
          </label>
          <select id="missionId" name="missionId" defaultValue="" className={inputClass}>
            <option value="">—</option>
            {missions.map((mission) => (
              <option key={mission.id} value={mission.id}>
                {mission.title}
              </option>
            ))}
          </select>
        </div>
      )}

      <button type="submit" className={buttonClass("primary")}>
        {text.createButton}
      </button>
    </form>
  );
}
