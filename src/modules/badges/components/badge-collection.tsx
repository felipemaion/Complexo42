import { badgeEmoji } from "../domain/icons";
import type { BadgeAward, BadgesText } from "../types";

type BadgeCollectionProps = {
  readonly awards: readonly BadgeAward[];
  readonly text: BadgesText;
};

export function BadgeCollection({ awards, text }: BadgeCollectionProps) {
  if (awards.length === 0) {
    return <p className="text-ink-muted">{text.empty}</p>;
  }

  return (
    <ul className="flex flex-col gap-3">
      {awards.map((award) => (
        <li
          key={award.awardId}
          className="flex gap-3 rounded-2xl border border-line bg-surface p-4"
        >
          <span className="text-3xl" aria-hidden="true">
            {badgeEmoji(award.icon)}
          </span>
          <div className="flex flex-col gap-1">
            <span className="text-lg font-bold">{award.name}</span>
            <span className="text-ink-muted">{award.reason}</span>
            <span className="text-base text-ink-muted">
              {new Date(award.awardedAt).toLocaleDateString("pt-BR")}
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}
