import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { instance } from "@config/instance";
import { openCase, requireCoordinationScreen } from "@/modules/houses";
import { answerSentence, crossOrder, totemCodes, totemLabel } from "@/modules/questionnaire";
import { SpiderChart } from "@/modules/questionnaire/components/spider-chart";
import { resolveCaseAction } from "../actions";
import { errorText as lookupErrorText, fill, shortDate } from "../../format";

export const metadata: Metadata = { title: instance.questionnaireCoordination.queue.title };

const QUEUE_PATH = "/coordenacao/casas/analise";
const field = "min-h-12 w-full rounded-xl border-2 border-current bg-transparent px-3 text-lg";

// Um caso inconclusivo: as respostas (frases da escala), o gráfico dos 4 eixos e o formulário para
// escolher a casa e o totem e resolver. Abrir registra o acesso. Sem permissão ou caso fora do
// escopo: 404. O erro vem em `?erro=` (código, nunca texto livre).
export default async function CasePage({
  params,
  searchParams,
}: Readonly<{ params: Promise<{ id: string }>; searchParams: Promise<{ erro?: string }> }>) {
  const { client, deps } = await requireCoordinationScreen("results");
  const { id } = await params;
  const opened = await openCase(client, id, deps);
  if (opened.status === "not_found") notFound();
  const text = instance.questionnaireCoordination;
  if (opened.status === "unreadable") {
    return (
      <main className="mx-auto flex max-w-2xl flex-col gap-6 p-6 pt-10">
        <p role="alert" className="rounded-xl border-l-4 border-danger bg-danger-soft p-4 text-lg">
          {text.queue.unreadableOne}
        </p>
        <Link href={QUEUE_PATH} className="text-center text-lg underline">
          {text.queue.backLink}
        </Link>
      </main>
    );
  }
  const errorCode = (await searchParams).erro;
  const errorText = lookupErrorText(text.errors, errorCode);
  const { axes } = deps.questionnaire;
  const axisName = (key: string) => (key in axes ? axes[key as keyof typeof axes].label : key);
  // Os quatro totens possíveis, com o nome e a descrição do mapa totemLabels do questionário.
  const totems = totemCodes(deps.questionnaire).map((code) => ({
    code,
    label: fill(text.queue.totemOption, {
      label: totemLabel(deps.questionnaire, code),
      description: deps.questionnaire.totemLabels[code]?.description ?? "",
    }),
  }));
  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 p-6 pt-10">
      <h1 className="text-3xl font-bold">{fill(text.queue.caseTitle, { name: opened.name ?? text.noName })}</h1>
      <p className="text-lg">
        <span className="font-semibold">{text.queue.tiedAxesLabel}: </span>
        {opened.tiedAxes.map(axisName).join(", ")} · {shortDate(opened.createdAt)}
      </p>
      {errorText && (
        <p role="alert" className="rounded-xl border-l-4 border-danger bg-danger-soft p-4 text-lg">
          {errorText}
        </p>
      )}
      <section className="flex flex-col gap-2" aria-labelledby="case-chart-title">
        <h2 id="case-chart-title" className="text-2xl font-bold">
          {text.queue.chartTitle}
        </h2>
        <SpiderChart
          chart={crossOrder(opened.chart)}
          title={text.queue.chartTitle}
          houses={{ byPoles: deps.questionnaire.houseByPoles, houses: instance.houses, currentHouseId: opened.houseId ?? undefined, currentLabel: text.queue.chartCurrentHouse }}
        />
      </section>
      <section className="flex flex-col gap-3" aria-labelledby="case-answers-title">
        <h2 id="case-answers-title" className="text-2xl font-bold">
          {text.queue.answersTitle}
        </h2>
        <ol className="flex flex-col gap-3 text-lg">
          {deps.questionnaire.items.map((item) => (
            <li key={item.id} data-testid="case-answer">
              <p className="font-semibold">{item.text}</p>
              <p>{answerSentence(item, opened.answers[item.id] ?? 0, instance.houseSelection.scaleIntensities)}</p>
            </li>
          ))}
        </ol>
      </section>
      <form action={resolveCaseAction} className="flex flex-col gap-4">
        <h2 className="text-2xl font-bold">{text.queue.resolveTitle}</h2>
        <input type="hidden" name="pedido" value={opened.requestId} />
        {opened.houseId !== null ? (
          // Pedido de totem: a casa já saiu pelos eixos da casa; o banco só aceita a do resultado.
          <>
            <input type="hidden" name="casa" value={opened.houseId} />
            <p className="text-lg" data-testid="case-house-fixed">
              {fill(text.queue.totemOnlyNotice, { house: instance.houses.find((house) => house.id === opened.houseId)?.name ?? opened.houseId })}
            </p>
          </>
        ) : (
          <label className="flex flex-col gap-1 text-lg font-semibold">
            {text.queue.houseLabel}
            <select name="casa" required defaultValue="" className={field}>
              <option value="" disabled />
              {instance.houses.map((house) => (
                <option key={house.id} value={house.id}>
                  {house.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="flex flex-col gap-1 text-lg font-semibold">
          {text.queue.totemLabel}
          <select name="totem" required defaultValue="" className={field}>
            <option value="" disabled />
            {totems.map((totem) => (
              <option key={totem.code} value={totem.code}>
                {totem.label}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="min-h-14 rounded-xl bg-primary px-5 py-3 text-lg font-bold text-on-primary">
          {text.queue.resolveButton}
        </button>
      </form>
      <Link href={QUEUE_PATH} className="text-center text-lg underline">
        {text.queue.backLink}
      </Link>
    </main>
  );
}
