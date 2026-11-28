"use client";
// Escala de intensidade (ADR 0014, #183 e #190): seis círculos, da ponta "a" (esquerda) à ponta "b"
// (direita), maiores nas pontas, sem meio e SEM nenhum marcado de início (resposta obrigatória).
// Abaixo dos círculos aparece a frase da posição (marcada, ou em foco/sob o mouse): a intensidade
// mais o texto da alternativa, e a mesma frase é o nome acessível do círculo. Acessível: grupo de
// rádio, teclado (setas, Home e End movem e marcam) e a frase marcada lida em voz alta. Só
// apresentação: a resposta sobe por `onChange`.
import { useId, useRef, useState } from "react";
import { answerValues, type Answer } from "../domain/score";
import { intensitySentence, toDisplaySentence } from "../domain/sentence";

type Props = {
  /** Pergunta do grupo para o leitor de tela (ex.: "Quanto você se identifica com a ou com b?"). */
  legend: string;
  /** Intensidade de cada círculo, da ponta "a" à ponta "b" (vem da config, R17). */
  intensities: readonly [string, string, string, string, string, string];
  /** Texto das duas alternativas, que ficam nas pontas. */
  poleA: string;
  poleB: string;
  value: Answer | undefined;
  onChange(value: Answer): void;
};

/** Diâmetro de cada círculo em px: maiores nas pontas. */
const diameterPx = [56, 44, 34, 34, 44, 56] as const;

export function IntensityScale({ legend, intensities, poleA, poleB, value, onChange }: Readonly<Props>) {
  const legendId = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const selected = value === undefined ? -1 : answerValues.indexOf(value);
  // Os três primeiros círculos são do polo "a", os três últimos do "b".
  const sentences = answerValues.map((_value, index) => intensitySentence(intensities[index]!, index < 3 ? poleA : poleB));
  const shownIndex = previewIndex ?? selected;

  const choose = (index: number) => {
    const wrapped = (index + answerValues.length) % answerValues.length;
    onChange(answerValues[wrapped]!);
    refs.current[wrapped]?.focus();
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
    // Largura limitada (#324): no computador a escala não se espalha pela tela e as pontas ficam perto dos círculos.
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      <div className="flex justify-between gap-4 text-lg font-semibold">
        <span className="max-w-[45%] text-left">{toDisplaySentence(poleA)}</span>
        <span className="max-w-[45%] text-right">{toDisplaySentence(poleB)}</span>
      </div>
      {/* Cada círculo ocupa um sexto da largura (#324): cabe em 360 px com alvo de 44 px ou mais, sem rolar de lado. */}
      <div role="radiogroup" aria-labelledby={legendId} className="flex items-center gap-0.5">
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
              aria-label={sentences[index]}
              tabIndex={isTabStop ? 0 : -1}
              data-testid={`scale-${answerValue}`}
              onClick={() => onChange(answerValue)}
              onKeyDown={(event) => onKeyDown(event, index)}
              onMouseEnter={() => setPreviewIndex(index)}
              onMouseLeave={() => setPreviewIndex(null)}
              onFocus={() => setPreviewIndex(index)}
              onBlur={() => setPreviewIndex(null)}
              className="flex min-h-14 min-w-0 flex-1 items-center justify-center"
            >
              <span
                style={{ width: `min(${diameterPx[index]}px, 100%)`, aspectRatio: "1" }}
                className={`block rounded-full border-4 transition-colors ${isPoleA ? "border-primary-ink" : "border-secondary-ink"} ${
                  isChecked ? (isPoleA ? "bg-primary-ink" : "bg-secondary-ink") : "bg-transparent"
                }`}
              />
            </button>
          );
        })}
      </div>
      {/* A frase em foco ou sob o mouse aparece só para quem enxerga; a marcada é lida em voz alta. */}
      <p className="min-h-14 text-center text-lg" aria-hidden="true" data-testid="scale-reading">
        {shownIndex === -1 ? "" : sentences[shownIndex]}
      </p>
      <p className="sr-only" aria-live="polite" data-testid="scale-selected">
        {selected === -1 ? "" : sentences[selected]}
      </p>
    </div>
  );
}
