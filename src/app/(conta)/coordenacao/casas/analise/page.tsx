import type { Metadata } from "next";
import Link from "next/link";
import { instance } from "@config/instance";
import { COORDINATION_PATH } from "@/modules/access";
import { listCases, requireCoordinationScreen } from "@/modules/houses";
import { fill, shortDate } from "../format";
import { noticeClass, PageShell, TableScroll, textLinkClass } from "@/modules/ui";

export const metadata: Metadata = { title: instance.questionnaireCoordination.queue.title };

// Fila de casos inconclusivos abertos (#174, ADR 0014): nome, data e eixos empatados. A RLS decide
// quais casos cada pessoa vê (nacional: todos; delegado: os do escopo). Linhas ilegíveis são avisadas.
export default async function QueuePage({ searchParams }: Readonly<{ searchParams: Promise<{ resolvido?: string }> }>) {
  const { client, deps } = await requireCoordinationScreen("results");
  const resolved = (await searchParams).resolvido === "1";
  const { rows, unreadable, truncated } = await listCases(client, deps);
  const text = instance.questionnaireCoordination;
  const axisName = (key: string) => (key in deps.questionnaire.axes ? deps.questionnaire.axes[key as keyof typeof deps.questionnaire.axes].label : key);
  return (
    <PageShell width="wide">
      <h1 className="text-3xl font-bold sm:text-4xl">{text.queue.title}</h1>
      <p className="max-w-prose text-lg text-ink-muted">{text.queue.intro}</p>
      {resolved && (
        <p role="status" className={noticeClass("info")} data-testid="resolved-notice">
          {text.queue.resolvedNotice}
        </p>
      )}
      {truncated && (
        <p role="status" className={noticeClass("info")} data-testid="truncated">
          {fill(text.queue.truncated, { count: rows.length })}
        </p>
      )}
      {unreadable > 0 && (
        <p role="status" className={noticeClass("info")} data-testid="unreadable">
          {fill(text.queue.unreadableList, { count: unreadable })}
        </p>
      )}
      {rows.length === 0 ? (
        <p className="text-lg">{text.queue.empty}</p>
      ) : (
        <TableScroll label={text.queue.title}>
        <table className="w-full text-left text-lg">
          <thead>
            <tr>
              <th className="py-2 pr-4 text-base font-semibold text-ink-muted">{text.queue.columnPerson}</th>
              <th className="py-2 pr-4 text-base font-semibold text-ink-muted">{text.queue.columnDate}</th>
              <th className="py-2 pr-4 text-base font-semibold text-ink-muted">{text.queue.columnAxes}</th>
              <th className="py-2 pr-4 text-base font-semibold text-ink-muted" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.requestId} className="border-t border-line" data-testid="case-row">
                <td className="py-2">{row.name ?? text.noName}</td>
                <td className="py-2">{shortDate(row.createdAt)}</td>
                <td className="py-2">
                  {row.legacyKey ? text.queue.legacyKey : row.tiedAxes.map(axisName).join(", ")}
                  {row.kind === "totem" && ` (${text.queue.kindTotem})`}
                </td>
                <td className="py-2 text-right">
                  <Link href={`/coordenacao/casas/analise/${row.requestId}`} prefetch={false} className="text-link underline">
                    {text.queue.openLink}
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </TableScroll>
      )}
      <Link href={COORDINATION_PATH} className={`${textLinkClass()} self-center`}>
        {text.backLink}
      </Link>
    </PageShell>
  );
}
