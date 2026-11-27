import { buttonClass } from "@/modules/ui";
import type { SearchText, SkillOption } from "../types";

type Props = {
  readonly skills: readonly SkillOption[];
  readonly selected: readonly string[];
  readonly text: SearchText;
};

export function SearchForm({ skills, selected, text }: Props) {
  const categories = Array.from(new Set(skills.map((skill) => skill.category)));

  return (
    <form method="get" className="flex flex-col gap-6">
      {categories.map((category) => {
        const categorySkills = skills.filter((skill) => skill.category === category);
        return (
          <fieldset key={category} className="flex flex-col gap-3">
            <legend className="text-lg font-bold text-secondary">{category}</legend>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {categorySkills.map((skill) => (
                <label
                  key={skill.id}
                  className="flex min-h-14 cursor-pointer items-center gap-3 rounded-xl border-2 border-line bg-surface px-4 text-lg"
                >
                  <input
                    type="checkbox"
                    name="h"
                    value={skill.id}
                    defaultChecked={selected.includes(skill.id)}
                    className="h-6 w-6 accent-primary"
                  />
                  <span>{skill.name}</span>
                </label>
              ))}
            </div>
          </fieldset>
        );
      })}
      <button type="submit" className={buttonClass("primary")}>
        {text.searchButton}
      </button>
    </form>
  );
}
