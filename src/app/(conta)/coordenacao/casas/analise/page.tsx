import type { Metadata } from "next";
import Link from "next/link";
import { instance } from "@config/instance";
import { COORDINATION_PATH } from "@/modules/access";
import { listCases, requireCoordinationScreen } from "@/modules/houses";
import { fill, shortDate } from "../format";

export const metadata: Metadata = { title: instance.questionnaireCoordination.queue.title };

// Fila de casos inconclusivos abertos (#174, ADR 0014): nome, data e eixos empatados. A RLS decide
// quais casos cada pessoa vê (nacional: todos; delegado: os do escopo). Linhas ilegíveis são avisadas.
export default async function QueuePage({ searchParams }: Readonly<{ searchParams: Promise<{ resolvido?: string }> }>) {
  const { client, deps } = await requireCoordinationScreen("results");
  const resolved = (await searchParams).resolvido === "1";
  const { rows, unreadable } = await listCases(client, deps);
  const text = instance.questionnaireCoordination;
  const axisName = (key: string) => (key in deps.questionnaire.axes ? deps.questionnaire.axes[key as keyof typeof deps.questionnaire.axes].label : key);
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 p-6 pt-10">
      <h1 className="text-3xl font-bold">{text.queue.title}</h1>
      <p className="text-lg">{text.queue.intro}</p>
      {resolved && (
        <p role="status" className="rounded-xl border-2 border-current p-3 text-lg" data-testid="resolved-notice">
          {text.queue.resolvedNotice}
        </p>
      )}
      {unreadable > 0 && (
        <p role="status" className="rounded-xl border-2 border-current p-3 text-lg" data-testid="unreadable">
          {fill(text.queue.unreadableList, { count: unreadable })}
        </p>
      )}
      {rows.length === 0 ? (
        <p className="text-lg">{text.queue.empty}</p>
      ) : (
        <table className="w-full text-left text-lg">
          <thead>
            <tr>
              <th className="py-2">{text.queue.columnPerson}</th>
              <th className="py-2">{text.queue.columnDate}</th>
              <th className="py-2">{text.queue.columnAxes}</th>
              <th className="py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.requestId} className="border-t border-current/30" data-testid="case-row">
                <td className="py-2">{row.name ?? text.noName}</td>
                <td className="py-2">{shortDate(row.createdAt)}</td>
                <td className="py-2">{row.tiedAxes.map(axisName).join(", ")}</td>
                <td className="py-2 text-right">
                  <Link href={`/coordenacao/casas/analise/${row.requestId}`} className="underline">
                    {text.queue.openLink}
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <Link href={COORDINATION_PATH} className="text-center text-lg underline">
        {text.backLink}
      </Link>
    </main>
  );
}
