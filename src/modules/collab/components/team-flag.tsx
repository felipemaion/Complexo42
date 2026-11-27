import type { CSSProperties } from "react";
import { EMBLEM_SYMBOL, type TeamIdentity } from "../identity";

// "Bandeira" da equipe (#56): as cores em faixas verticais e o emblema num círculo escuro no
// centro. Nenhum texto fica sobre as cores da equipe, então o contraste não depende delas.
// As cores vêm do banco (só #rrggbb) e entram como variáveis CSS, não como cor fixa no código.
const STRIPES = ["bg-(--flag-0)", "bg-(--flag-1)", "bg-(--flag-2)"] as const;

type TeamFlagProps = {
  readonly identity: TeamIdentity;
  readonly label: string;
  readonly size?: "large" | "small";
};

export function TeamFlag({ identity, label, size = "large" }: TeamFlagProps) {
  if (identity.colors.length < 2 && !identity.emblem) return null;
  const vars = Object.fromEntries(identity.colors.slice(0, 3).map((color, index) => [`--flag-${index}`, color])) as CSSProperties;
  const box = size === "large" ? "h-28 w-44" : "h-11 w-16";
  const badge = size === "large" ? "h-14 w-14 text-3xl" : "h-8 w-8 text-lg";
  return (
    <span role="img" aria-label={label} style={vars} className={`relative flex shrink-0 overflow-hidden rounded-xl border border-line ${box}`}>
      {identity.colors.slice(0, 3).map((color, index) => (
        <span key={`${color}-${index}`} className={`flex-1 ${STRIPES[index]}`} />
      ))}
      {identity.emblem && (
        <span aria-hidden="true" className={`absolute inset-0 m-auto flex items-center justify-center rounded-full border-2 border-primary bg-canvas ${badge}`}>
          {EMBLEM_SYMBOL[identity.emblem]}
        </span>
      )}
    </span>
  );
}
