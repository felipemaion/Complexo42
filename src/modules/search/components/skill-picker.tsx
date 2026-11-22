"use client";
import { useMemo, useState } from "react";
import { inputClass, labelClass } from "@/modules/ui/domain/button-class";
import type { SelectableSkill } from "../server/my-skills";

// Escolha das próprias habilidades (#15), pensada para o celular: caixa de busca que filtra por
// nome, área ou sinônimo (sem acento), áreas em grupos e caixas grandes (48 px). Ao chegar no
// limite, as não marcadas ficam travadas. Sem JavaScript, a lista inteira continua funcionando.

type PickerText = {
  readonly searchLabel: string;
  readonly counter: string;
  readonly limitReached: string;
  readonly noMatch: string;
};

type SkillPickerProps = {
  readonly skills: readonly SelectableSkill[];
  readonly selected: readonly string[];
  readonly max: number;
  readonly text: PickerText;
};

function normalize(value: string): string {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

function groupByCategory(skills: readonly SelectableSkill[]): readonly (readonly [string, readonly SelectableSkill[]])[] {
  const groups = new Map<string, SelectableSkill[]>();
  for (const skill of skills) groups.set(skill.category, [...(groups.get(skill.category) ?? []), skill]);
  return [...groups.entries()];
}

export function SkillPicker({ skills, selected, max, text }: SkillPickerProps) {
  const [query, setQuery] = useState("");
  const [checked, setChecked] = useState<ReadonlySet<string>>(() => new Set(selected));
  const groups = useMemo(() => groupByCategory(skills), [skills]);
  const search = useMemo(
    () => new Map(skills.map((s) => [s.id, normalize([s.name, s.category, ...s.aliases].join(" "))])),
    [skills],
  );

  const wanted = normalize(query.trim());
  const matches = (skill: SelectableSkill) => wanted === "" || (search.get(skill.id) ?? "").includes(wanted);
  const isFull = checked.size >= max;
  const anyVisible = skills.some(matches);

  const toggle = (id: string) =>
    setChecked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <label htmlFor="skill-filter" className={labelClass}>
          {text.searchLabel}
        </label>
        <input
          id="skill-filter"
          type="search"
          autoComplete="off"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className={inputClass}
        />
      </div>
      <p aria-live="polite" className="text-lg font-semibold">
        {text.counter.replace("{count}", String(checked.size)).replace("{max}", String(max))}
        {isFull && ` ${text.limitReached}`}
      </p>
      {!anyVisible && <p className="text-lg text-ink-muted">{text.noMatch}</p>}
      {groups.map(([category, items]) => (
        <fieldset key={category} hidden={!items.some(matches)} className="flex flex-col gap-3">
          <legend className="mb-2 text-xl font-bold">{category}</legend>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((skill) => {
              const isOn = checked.has(skill.id);
              return (
                <label
                  key={skill.id}
                  hidden={!matches(skill)}
                  className="flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border-2 border-line bg-surface px-4 py-2 text-lg has-[:checked]:border-primary has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60"
                >
                  <input
                    type="checkbox"
                    name="skill"
                    value={skill.id}
                    checked={isOn}
                    disabled={!isOn && isFull}
                    onChange={() => toggle(skill.id)}
                    className="h-6 w-6 shrink-0 accent-primary"
                  />
                  <span>{skill.name}</span>
                </label>
              );
            })}
          </div>
        </fieldset>
      ))}
    </div>
  );
}
