"use client";
// "Escolher outra casa" com comparação (#240): as quatro casas, a sugerida em destaque; ao selecionar uma, o perfil da pessoa
// ao lado do perfil médio dos membros da casa (só com membros suficientes) e o que se espera nela. Só apresentação: a chave, as
// frases de expectativa e as notas dos membros ficam no servidor (compareHouseAction devolve só texto e o agregado arredondado).
// Nada do totem aparece.
import { useEffect, useState } from "react";
import type { InstanceConfig } from "@/modules/instance";
import { answerValues, type ChartAxis, type HouseByPoles } from "@/modules/questionnaire";
import { SpiderChart } from "@/modules/questionnaire/components/spider-chart";
import { compareHouseAction } from "../server/actions";
import { CompareHouseGrid } from "./compare-grid";
import type { HouseView } from "./house-presentation";

type Text = InstanceConfig["houseSelection"];

type Comparison =
  | { status: "loading" }
  | { status: "failed"; expired?: boolean }
  | {
      status: "ready";
      expectations: { text: string; answer: number }[];
      average: { status: "ok"; scores: { house1: number; house2: number } } | { status: "few" } | { status: "unavailable" };
    };

type Props = {
  houses: readonly HouseView[];
  suggestedId: string | undefined;
  /** Troca de casa (#268): a casa em que a pessoa está hoje (em destaque; não se confirma). */
  currentId: string | undefined;
  selectedId: string | undefined;
  chart: readonly ChartAxis[] | undefined;
  byPoles: HouseByPoles | undefined;
  /** Token das respostas (selado pelo servidor ao pontuar): a comparação o usa, o navegador não o lê nem manda respostas. */
  compareToken: string | undefined;
  text: Text;
  disabled: boolean;
  onSelect(houseId: string): void;
  onConfirm(): void;
  onBack(): void;
};

const big = "min-h-14 w-full rounded-xl border-2 border-current px-5 py-3 text-left text-lg font-semibold";
const primary =
  "min-h-14 w-full rounded-xl bg-[var(--color-primary)] px-5 py-3 text-lg font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40";

export function CompareHouses({ houses, suggestedId, currentId, selectedId, chart, byPoles, compareToken, text, disabled, onSelect, onConfirm, onBack }: Readonly<Props>) {
  const t = text.compare;
  // A comparação da casa selecionada (servidor). Resultado de outra casa não aparece: a chave da casa vai junto.
  const [loaded, setLoaded] = useState<{ houseId: string; comparison: Comparison } | null>(null);
  useEffect(() => {
    if (selectedId === undefined) return;
    let cancelled = false;
    void (async () => {
      const response = compareToken ? await compareHouseAction({ houseId: selectedId, token: compareToken }) : ({ ok: false, error: "failed" } as const);
      if (cancelled) return;
      setLoaded({ houseId: selectedId, comparison: response.ok ? { status: "ready", expectations: [...response.expectations], average: response.average } : { status: "failed", ...(response.error === "expired" && { expired: true }) } });
    })();
    return () => {
      cancelled = true;
    };
    // O token não muda nesta tela: a comparação refaz só ao trocar de casa.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);
  const comparison: Comparison = selectedId !== undefined && loaded?.houseId === selectedId ? loaded.comparison : { status: "loading" };
  const selected = houses.find((house) => house.id === selectedId);
  const averageChart =
    comparison.status === "ready" && comparison.average.status === "ok" && chart
      ? (() => {
          const scores = comparison.average.scores;
          return chart.map((axis) => ({ ...axis, score: axis.key === "house1" ? scores.house1 : axis.key === "house2" ? scores.house2 : axis.score }));
        })()
      : undefined;

  return (
    <div className="flex flex-col gap-4" data-testid="compare-houses">
      <button type="button" className={big} onClick={onBack} disabled={disabled}>
        {t.backButton}
      </button>
      <h2 className="text-2xl font-bold">{t.title}</h2>
      <p className="text-lg">{t.intro}</p>
      <CompareHouseGrid houses={houses} suggestedId={suggestedId} currentId={currentId} selectedId={selectedId} text={t} disabled={disabled} onSelect={onSelect} />
      {selected && (
        <section className="flex flex-col gap-4" aria-labelledby="compare-detail-title" data-testid="compare-detail">
          <h3 id="compare-detail-title" className="text-xl font-bold">
            {selected.name}
          </h3>
          <p className="text-lg" data-testid="compare-description">{selected.description}</p>
          {comparison.status === "loading" && <p role="status" className="text-lg">{t.loading}</p>}
          {chart && chart.length > 0 && (
            <div className="flex flex-col gap-2">
              <p className="text-lg font-semibold">{t.chartTitle}</p>
              <SpiderChart
                chart={chart}
                title={t.chartTitle}
                {...(byPoles && { houses: { byPoles, houses, currentHouseId: selected.id, currentLabel: t.selectedBadge } })}
                {...(averageChart && { compare: { chart: averageChart, label: t.averageLabel } })}
              />
              {comparison.status === "ready" && comparison.average.status === "ok" && (
                <p className="text-base" data-testid="average-note">{t.averageNote}</p>
              )}
              {comparison.status === "ready" && comparison.average.status === "few" && (
                <p className="rounded-xl border-2 border-current p-3 text-lg" data-testid="few-members">{t.fewMembers}</p>
              )}
              {comparison.status === "ready" && comparison.average.status === "unavailable" && (
                <p className="text-lg" role="status">{t.averageUnavailable}</p>
              )}
            </div>
          )}
          {comparison.status === "ready" && (
            <div className="flex flex-col gap-2" data-testid="expectations">
              <h4 className="text-xl font-semibold">{t.expectTitle}</h4>
              {comparison.expectations.length === 0 ? (
                <p className="text-lg">{t.expectNone}</p>
              ) : (
                <>
                  <p className="text-lg">{t.expectIntro}</p>
                  <ul className="flex flex-col gap-3">
                    {comparison.expectations.map((item) => (
                      <li key={item.text} className="text-lg" data-testid="expectation">
                        <strong>{text.scaleIntensities[answerValues.indexOf(item.answer as (typeof answerValues)[number])]}:</strong> {item.text}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}
          {comparison.status === "failed" && <p role="alert" className="text-lg" data-testid={comparison.expired ? "compare-expired" : undefined}>{comparison.expired ? t.expiredReload : t.expectUnavailable}</p>}
          <button type="button" className={primary} onClick={onConfirm} disabled={disabled || selected.id === currentId} data-testid="compare-confirm">
            {t.confirmButton}
          </button>
        </section>
      )}
    </div>
  );
}
