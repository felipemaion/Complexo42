"use client";
// Autocomplete de habilidades da busca (#23): digita e escolhe de uma lista que também acha sinônimos (sem caixa e
// sem acento, como no banco). As escolhidas viram `h` no formulário GET (a busca fica na URL). Teclado: setas
// movem, Enter escolhe, Esc fecha; no celular, itens grandes. No máximo `max` escolhidas.
import { useId, useMemo, useState } from "react";
import { normalizeSkillText } from "../domain/skill-name";
import { fieldClass } from "@/modules/ui";

type Skill = { id: string; name: string; category: string; aliases: readonly string[] };

type Props = {
  skills: readonly Skill[];
  selected: readonly string[];
  max: number;
  text: { skillLabel: string; removeSkill: string };
};

const maxOptions = 8;

export function SkillSearchPicker({ skills, selected, max, text }: Readonly<Props>) {
  const listId = useId();
  const [chosen, setChosen] = useState<readonly string[]>(() => selected.filter((id) => skills.some((s) => s.id === id)));
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const term = normalizeSkillText(query);
  const byId = useMemo(() => new Map(skills.map((s) => [s.id, s])), [skills]);
  const options = useMemo(() => {
    if (term === "") return [];
    return skills
      .filter((s) => !chosen.includes(s.id) && (normalizeSkillText(s.name).includes(term) || s.aliases.some((alias) => alias.includes(term))))
      .slice(0, maxOptions);
  }, [skills, chosen, term]);
  const full = chosen.length >= max;

  function pick(id: string) {
    if (full) return;
    setChosen((previous) => (previous.includes(id) ? previous : [...previous, id]));
    setQuery("");
    setOpen(false);
    setActive(0);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActive((index) => Math.min(index + 1, options.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter" && open && options[active]) {
      event.preventDefault();
      pick(options[active].id);
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-wrap gap-2" aria-label={text.skillLabel}>
        {chosen.map((id) => (
          <li key={id} className="flex items-center gap-2 rounded-full border-2 border-primary-ink bg-surface px-3 py-1 text-lg" data-testid="chosen-skill">
            <input type="hidden" name="h" value={id} />
            {byId.get(id)?.name ?? id}
            <button type="button" className="min-h-target min-w-target text-xl" aria-label={`${text.removeSkill} ${byId.get(id)?.name ?? ""}`} onClick={() => setChosen((previous) => previous.filter((other) => other !== id))}>
              ×
            </button>
          </li>
        ))}
      </ul>
      {!full && (
        <div className="relative">
          <input
            type="text"
            role="combobox"
            aria-label={text.skillLabel}
            aria-expanded={open && options.length > 0}
            aria-controls={listId}
            aria-autocomplete="list"
            autoComplete="off"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setOpen(true);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
            className={fieldClass()}
          />
          <ul id={listId} role="listbox" hidden={!(open && options.length > 0)} className="absolute z-10 mt-1 w-full overflow-hidden rounded-control border-2 border-field bg-surface shadow-card">
            {options.map((skill, index) => (
              <li
                key={skill.id}
                role="option"
                aria-selected={index === active}
                tabIndex={-1}
                className={`min-h-target cursor-pointer px-3 py-3 text-lg ${index === active ? "bg-soft font-bold" : ""}`}
                onMouseDown={(event) => {
                  event.preventDefault();
                  pick(skill.id);
                }}
              >
                {skill.name} <span className="text-base text-ink-muted">· {skill.category}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
