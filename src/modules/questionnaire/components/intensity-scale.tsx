"use client";
// Escala de intensidade (ADR 0014, #183): seis círculos, de "muito a" (esquerda) a "muito b"
// (direita), maiores nas pontas, sem meio e SEM nenhum marcado de início (resposta obrigatória).
// Acessível: grupo de rádio com os seis nomes, teclado (setas, Home e End movem e marcam) e o
// nome da opção marcada lido em voz alta. Só apresentação: a resposta sobe por `onChange`.
import { useId, useRef } from "react";
import { answerValues, type Answer } from "../domain/score";

type Props = {
  /** Pergunta do grupo para o leitor de tela (ex.: "Quanto você se identifica com a ou com b?"). */
  legend: string;
  /** Nome de cada círculo, de "muito a" a "muito b" (vem da config, R17). */
  options: readonly [string, string, string, string, string, string];
  /** Texto das duas alternativas, que ficam nas pontas. */
  poleA: string;
  poleB: string;
  value: Answer | undefined;
  onChange(value: Answer): void;
};

/** Diâmetro de cada círculo em px: maiores nas pontas. */
const diameterPx = [56, 44, 34, 34, 44, 56] as const;

export function IntensityScale({ legend, options, poleA, poleB, value, onChange }: Readonly<Props>) {
  const legendId = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const selected = value === undefined ? -1 : answerValues.indexOf(value);

  const choose = (index: number) => {
    const next = answerValues[(index + answerValues.length) % answerValues.length]!;
    onChange(next);
    refs.current[(index + answerValues.length) % answerValues.length]?.focus();
  };
  const onKeyDown = (event: React.KeyboardEvent, index: number) => {
    const moves: Record<string, number> = {
      ArrowLeft: index - 1,
      ArrowUp: index - 1,
      ArrowRight: index + 1,
      ArrowDown: index + 1,
      Home: 0,
      End: answerValues.length - 1,
    };
    const target = moves[event.key];
    if (target === undefined) return;
    event.preventDefault();
    choose(target);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-between gap-4 text-lg font-semibold">
        <span className="max-w-[45%] text-left">a) {poleA}</span>
        <span className="max-w-[45%] text-right">b) {poleB}</span>
      </div>
      <div role="radiogroup" aria-labelledby={legendId} className="flex items-center justify-between gap-1">
        <span id={legendId} className="sr-only">
          {legend}
        </span>
        {answerValues.map((answerValue, index) => {
          const isChecked = selected === index;
          const isTabStop = isChecked || (selected === -1 && index === 0);
          const isPoleA = answerValue < 0;
          return (
            <button
              key={answerValue}
              ref={(node) => {
                refs.current[index] = node;
              }}
              type="button"
              role="radio"
              aria-checked={isChecked}
              aria-label={options[index]}
              tabIndex={isTabStop ? 0 : -1}
              data-testid={`scale-${answerValue}`}
              onClick={() => onChange(answerValue)}
              onKeyDown={(event) => onKeyDown(event, index)}
              className="flex min-h-14 min-w-11 items-center justify-center"
            >
              <span
                style={{ width: diameterPx[index], height: diameterPx[index] }}
                className={`block rounded-full border-4 ${isPoleA ? "border-[var(--color-primary)]" : "border-[var(--color-secondary)]"} ${
                  isChecked ? (isPoleA ? "bg-[var(--color-primary)]" : "bg-[var(--color-secondary)]") : "bg-transparent"
                }`}
              />
            </button>
          );
        })}
      </div>
      <p className="min-h-7 text-center text-lg" aria-live="polite" data-testid="scale-reading">
        {selected === -1 ? "" : options[selected]}
      </p>
    </div>
  );
}
