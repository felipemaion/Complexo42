import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { instance } from "@config/instance";
import { choseOtherHouse, openResult, requireCoordinationScreen } from "@/modules/houses";
import { crossOrder, totemLabel } from "@/modules/questionnaire";
import { SpiderChart } from "@/modules/questionnaire/components/spider-chart";
import { changeHouseAction } from "../actions";
import { errorText as lookupErrorText, fill, houseName, shortDate } from "../../format";

export const metadata: Metadata = { title: instance.questionnaireCoordination.results.title };

const RESULTS_PATH = "/coordenacao/casas/resultados";

// Um resultado, como a coordenação o vê: casa, totem e o gráfico dos 4 eixos (polos opostos frente a
// frente). Abrir registra o acesso (ator e alvo, sem conteúdo). Sem permissão ou sem resultado visível: 404.
export default async function ResultPage({
  params,
  searchParams,
}: Readonly<{ params: Promise<{ id: string }>; searchParams: Promise<{ erro?: string; trocada?: string }> }>) {
  const { client, deps } = await requireCoordinationScreen("results");
  const personId = (await params).id;
  const query = await searchParams;
  const opened = await openResult(client, personId, deps);
  if (opened.status === "not_found") notFound();
  const text = instance.questionnaireCoordination;
  if (opened.status === "unreadable") {
    return (
      <main className="mx-auto flex max-w-2xl flex-col gap-6 p-6 pt-10">
        <p role="alert" className="rounded-xl border-2 border-red-700 p-4 text-lg">
          {text.results.unreadableOne}
        </p>
        <Link href={RESULTS_PATH} className="text-center text-lg underline">
          {text.results.backLink}
        </Link>
      </main>
    );
  }
  const { result, name, choice } = opened;
  const differs = choseOtherHouse({ houseId: result.houseId, chosenHouseId: choice.houseId });
  const errorText = lookupErrorText(text.errors, query.erro);
  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 p-6 pt-10">
      <h1 className="text-3xl font-bold">{fill(text.results.detailTitle, { name: name ?? text.noName })}</h1>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-lg">
        <dt className="font-semibold">{text.results.houseLabel}</dt>
        <dd data-testid="result-house">{houseName(result.houseId)}</dd>
        <dt className="font-semibold">{text.results.chosenLabel}</dt>
        <dd data-testid="result-chosen" data-differs={differs ? "true" : "false"} className={differs ? "font-bold underline decoration-2" : undefined}>
          {choice.houseId ? houseName(choice.houseId) : text.results.chosenNone}
          {differs && <span className="block font-normal">{text.results.differsMark}</span>}
          {choice.changedByCoordinationAt && <span className="block font-normal">{fill(text.results.changedByCoordination, { date: shortDate(choice.changedByCoordinationAt) })}</span>}
        </dd>
        {choice.chosenAt && (
          <>
            <dt className="font-semibold">{text.results.chosenDateLabel}</dt>
            <dd>{shortDate(choice.chosenAt)}</dd>
          </>
        )}
        <dt className="font-semibold">{text.results.totemLabel}</dt>
        <dd data-testid="result-totem">{result.totem !== null ? totemLabel(deps.questionnaire, result.totem) : result.totemState === "undecided" ? text.results.totemUndecided : text.results.totemPending}</dd>
        <dt className="font-semibold">{text.results.dateLabel}</dt>
        <dd>{shortDate(result.createdAt)}</dd>
      </dl>
      {result.chart ? (
        <section className="flex flex-col gap-2" aria-labelledby="result-chart-title">
          <h2 id="result-chart-title" className="text-2xl font-bold">
            {text.results.chartTitle}
          </h2>
          <SpiderChart
            chart={crossOrder(result.chart)}
            title={text.results.chartTitle}
            houses={{ byPoles: deps.questionnaire.houseByPoles, houses: instance.houses, currentHouseId: result.houseId, currentLabel: text.results.chartCurrentHouse }}
          />
        </section>
      ) : (
        <p className="text-lg">{text.results.noScores}</p>
      )}
      {errorText && (
        <p role="alert" className="rounded-xl border-2 border-red-700 p-4 text-lg">
          {errorText}
        </p>
      )}
      {query.trocada === "1" && (
        <p role="status" className="rounded-xl border-2 border-current p-4 text-lg">
          {text.results.changedNotice}
        </p>
      )}
      <form action={changeHouseAction} className="flex flex-col gap-3" data-testid="change-house-form">
        <h2 className="text-2xl font-bold">{text.results.changeHouseTitle}</h2>
        <input type="hidden" name="pessoa" value={personId} />
        <label className="flex flex-col gap-1 text-lg font-semibold">
          {text.results.changeHouseLabel}
          <select name="casa" required defaultValue="" className="min-h-12 w-full rounded-xl border-2 border-current bg-transparent px-3 text-lg">
            <option value="" disabled />
            {instance.houses.map((house) => (
              <option key={house.id} value={house.id}>
                {house.name}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="min-h-14 rounded-xl bg-[var(--color-primary)] px-5 py-3 text-lg font-semibold text-white">
          {text.results.changeHouseButton}
        </button>
      </form>
      <Link href={RESULTS_PATH} className="text-center text-lg underline">
        {text.results.backLink}
      </Link>
    </main>
  );
}
