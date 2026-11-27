import { buttonClass } from "@/modules/ui";
import { inputClass, labelClass, Notice } from "@/modules/ui";
import { badgeEmoji } from "../domain/icons";
import type { BadgeOption, BadgesText } from "../types";

type GrantFormPerson = {
  readonly profileId: string;
  readonly displayName: string;
};

type GrantFormProps = {
  readonly badges: readonly BadgeOption[];
  readonly people: readonly GrantFormPerson[];
  readonly text: BadgesText;
  readonly grantAction: (formData: FormData) => Promise<void>;
};

export function GrantForm({ badges, people, text, grantAction }: GrantFormProps) {
  if (badges.length === 0 || people.length === 0) {
    return <Notice tone="info">{text.nothingToGrant}</Notice>;
  }

  return (
    <form action={grantAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <label htmlFor="badgeId" className={labelClass}>
          {text.badgeLabel}
        </label>
        <select id="badgeId" name="badgeId" required className={inputClass}>
          {badges.map((badge) => (
            <option key={badge.id} value={badge.id}>
              {badgeEmoji(badge.icon)} {badge.name}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="profileId" className={labelClass}>
          {text.personLabel}
        </label>
        <select id="profileId" name="profileId" required className={inputClass}>
          {people.map((person) => (
            <option key={person.profileId} value={person.profileId}>
              {person.displayName}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="reason" className={labelClass}>
          {text.reasonLabel}
        </label>
        <textarea
          id="reason"
          name="reason"
          required
          minLength={3}
          maxLength={300}
          rows={3}
          className={inputClass}
        />
      </div>

      <button type="submit" className={buttonClass("primary")}>
        {text.grantButton}
      </button>
    </form>
  );
}
