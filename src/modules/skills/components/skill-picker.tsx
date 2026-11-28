"use client";
// Seleção de habilidades (#15): marcação múltipla com busca, em grupos, que funciona no celular (alvos grandes,
// sem hover). Sem nível: só marcar. Chega ao máximo, as outras ficam desabilitadas (o banco confere de qualquer
// jeito). As escolhidas saem no formulário como `habilidade`; as que a busca esconde continuam no formulário.
import { useMemo, useState } from "react";
import { normalizeSkillText } from "../domain/skill-name";

type Skill = { id: string; name: string; category: string };

type Props = {
  skills: readonly Skill[];
  selected: readonly string[];
  max: number;
  text: { searchLabel: string; counter: string; limitReached: string; empty: string };
};

export function SkillPicker({ skills, selected, max, text }: Readonly<Props>) {
  const [chosen, setChosen] = useState<ReadonlySet<string>>(() => new Set(selected));
  const [query, setQuery] = useState("");
  const term = normalizeSkillText(query);
  const groups = useMemo(() => {
    const byCategory = new Map<string, Skill[]>();
    for (const skill of skills) byCategory.set(skill.category, [...(byCategory.get(skill.category) ?? []), skill]);
    return [...byCategory.entries()];
  }, [skills]);
  const full = chosen.size >= max;
  const shown = (skill: Skill) => term === "" || normalizeSkillText(`${skill.name} ${skill.category}`).includes(term);
  const anyShown = skills.some(shown);

  function toggle(id: string, on: boolean) {
    setChosen((previous) => {
      const next = new Set(previous);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <label className="flex flex-col gap-1 text-lg font-semibold">
        {text.searchLabel}
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          autoComplete="off"
          className="min-h-12 w-full rounded-xl border-2 border-current bg-transparent px-3 text-lg font-normal"
        />
      </label>
      <p className="text-lg font-semibold" data-testid="skills-counter" aria-live="polite">
        {text.counter.replace("{count}", String(chosen.size)).replace("{max}", String(max))}
      </p>
      {full && <p className="text-base">{text.limitReached}</p>}
      {!anyShown && <p className="text-lg">{text.empty}</p>}
      {groups.map(([category, items]) => (
        <fieldset key={category} className="flex flex-col gap-2" hidden={!items.some(shown)}>
          <legend className="text-xl font-bold">{category}</legend>
          {items.map((skill) => {
            const checked = chosen.has(skill.id);
            return (
              <label
                key={skill.id}
                hidden={!shown(skill)}
                className="flex min-h-12 items-center gap-3 rounded-xl border-2 border-current px-3 py-2 text-lg has-[:disabled]:opacity-50"
              >
                <input
                  type="checkbox"
                  name="habilidade"
                  value={skill.id}
                  checked={checked}
                  disabled={!checked && full}
                  onChange={(event) => toggle(skill.id, event.target.checked)}
                  className="h-6 w-6"
                />
                {skill.name}
              </label>
            );
          })}
        </fieldset>
      ))}
    </div>
  );
}
