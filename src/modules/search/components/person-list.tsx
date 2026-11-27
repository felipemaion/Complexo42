import { Notice, Tag } from "@/modules/ui";
import type { PersonResult, SearchText } from "../types";

type Props = {
  readonly people: readonly PersonResult[];
  readonly text: SearchText;
};

export function PersonList({ people, text }: Props) {
  if (people.length === 0) {
    return <Notice tone="info">{text.empty}</Notice>;
  }

  return (
    <ul className="flex flex-col gap-4">
      {people.map((person) => (
        <li
          key={person.profileId}
          className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-5"
        >
          <h2 className="text-xl font-bold">{person.displayName}</h2>
          <div className="flex flex-wrap gap-2">
            {person.skillNames.map((skillName) => (
              <Tag key={skillName} tone="neutral">
                {skillName}
              </Tag>
            ))}
          </div>
        </li>
      ))}
    </ul>
  );
}
