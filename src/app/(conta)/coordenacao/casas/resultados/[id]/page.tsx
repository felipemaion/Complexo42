import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { instance } from "@config/instance";
import { openResult, requireCoordinationScreen } from "@/modules/houses";
import { crossOrder, totemLabel } from "@/modules/questionnaire";
import { SpiderChart } from "@/modules/questionnaire/components/spider-chart";
import { fill, houseName, shortDate } from "../../format";

export const metadata: Metadata = { title: instance.questionnaireCoordination.results.title };

const RESULTS_PATH = "/coordenacao/casas/resultados";

// Um resultado, como a coordenação o vê: casa, totem e o gráfico dos 4 eixos (polos opostos frente a
// frente). Abrir registra o acesso (ator e alvo, sem conteúdo). Sem permissão ou sem resultado visível: 404.
export default async function ResultPage({ params }: Readonly<{ params: Promise<{ id: string }> }>) {
  const { client, deps } = await requireCoordinationScreen("results");
  const opened = await openResult(client, (await params).id, deps);
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
  const { result, name } = opened;
  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 p-6 pt-10">
      <h1 className="text-3xl font-bold">{fill(text.results.detailTitle, { name: name ?? text.noName })}</h1>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-lg">
        <dt className="font-semibold">{text.results.houseLabel}</dt>
        <dd data-testid="result-house">{houseName(result.houseId)}</dd>
        <dt className="font-semibold">{text.results.totemLabel}</dt>
        <dd data-testid="result-totem">{totemLabel(deps.questionnaire, result.totem)}</dd>
        <dt className="font-semibold">{text.results.dateLabel}</dt>
        <dd>{shortDate(result.createdAt)}</dd>
      </dl>
      {result.chart ? (
        <section className="flex flex-col gap-2" aria-labelledby="result-chart-title">
          <h2 id="result-chart-title" className="text-2xl font-bold">
            {text.results.chartTitle}
          </h2>
          <SpiderChart
            axes={crossOrder(result.chart)}
            title={text.results.chartTitle}
            houses={{ byPoles: deps.questionnaire.houseByPoles, houses: instance.houses, currentHouseId: result.houseId, currentLabel: text.results.chartCurrentHouse }}
          />
        </section>
      ) : (
        <p className="text-lg">{text.results.noScores}</p>
      )}
      <Link href={RESULTS_PATH} className="text-center text-lg underline">
        {text.results.backLink}
      </Link>
    </main>
  );
}
