import type { Metadata } from "next";
import Link from "next/link";
import { instance } from "@config/instance";
import { COORDINATION_PATH } from "@/modules/access";
import { choseOtherHouse, listResults, requireCoordinationScreen } from "@/modules/houses";
import { HouseWithShield } from "@/modules/houses/components/house-shield";
import { fill, houseName, shortDate } from "../format";
import { buttonClass, fieldClass, noticeClass, PageShell, TableScroll, textLinkClass } from "@/modules/ui";

export const metadata: Metadata = { title: instance.questionnaireCoordination.results.title };

const field = `${fieldClass()} sm:w-auto`;

// Resultados do questionário (#174, ADR 0014): pessoas ativas do escopo de quem vê (nacional: todas;
// delegado: as da concessão), com casa, totem e data. Quem não tem permissão recebe 404; a RLS decide
// quem aparece. A lista não traz totem nem nota; abrir uma pessoa (que os mostra) é registrado.
export default async function ResultsPage({ searchParams }: Readonly<{ searchParams: Promise<{ casa?: string | string[]; outra?: string | string[] }> }>) {
  const { client, deps } = await requireCoordinationScreen("results");
  const query = await searchParams;
  const raw = query.casa;
  const otherHouse = query.outra === "1";
  const houseId = typeof raw === "string" && instance.houses.some((house) => house.id === raw) ? raw : undefined;
  const { rows, truncated } = await listResults(client, deps, { houseId, otherHouse });
  const text = instance.questionnaireCoordination;
  return (
    <PageShell width="wide">
      <h1 className="text-3xl font-bold sm:text-4xl">{text.results.title}</h1>
      <p className="max-w-prose text-lg text-ink-muted">{text.results.intro}</p>
      <form method="get" className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-lg font-semibold">
          {text.results.houseFilterLabel}
          <select name="casa" defaultValue={houseId ?? ""} className={field}>
            <option value="">{text.results.houseFilterAll}</option>
            {instance.houses.map((house) => (
              <option key={house.id} value={house.id}>
                {house.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-h-12 items-center gap-2 text-lg font-semibold">
          <input type="checkbox" name="outra" value="1" defaultChecked={otherHouse} className="size-5" />
          {text.results.otherHouseFilter}
        </label>
        <button type="submit" className={buttonClass("primary")}>
          {text.results.filterButton}
        </button>
      </form>
      {truncated && (
        <p role="status" className={noticeClass("info")} data-testid="truncated">
          {fill(text.results.truncated, { count: rows.length })}
        </p>
      )}
      {rows.length === 0 ? (
        <p className="text-lg">{text.results.empty}</p>
      ) : (
        <TableScroll label={text.results.title}>
        <table className="w-full text-left text-lg">
          <thead>
            <tr>
              <th className="py-2 pr-4 text-base font-semibold text-ink-muted">{text.results.columnPerson}</th>
              <th className="py-2 pr-4 text-base font-semibold text-ink-muted">{text.results.columnHouse}</th>
              <th className="py-2 pr-4 text-base font-semibold text-ink-muted">{text.results.columnChosen}</th>
              <th className="py-2 pr-4 text-base font-semibold text-ink-muted">{text.results.columnDate}</th>
              <th className="py-2 pr-4 text-base font-semibold text-ink-muted" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.profileId} className="border-t border-line" data-testid="result-row">
                <td className="py-2">{row.name ?? text.noName}</td>
                <td className="py-2"><HouseWithShield houseId={row.houseId} name={houseName(row.houseId)} size={24} /></td>
                <td className={choseOtherHouse(row) ? "py-2 font-bold underline decoration-2" : "py-2"} data-testid="result-chosen" data-differs={choseOtherHouse(row) ? "true" : "false"}>
                  {row.chosenHouseId ? <HouseWithShield houseId={row.chosenHouseId} name={houseName(row.chosenHouseId)} size={24} /> : text.results.chosenNone}
                  {choseOtherHouse(row) && <span className="block text-base font-normal">{text.results.differsMark}</span>}
                  {row.changedByCoordinationAt && (
                    <span className="block text-base font-normal">{fill(text.results.changedByCoordination, { date: shortDate(row.changedByCoordinationAt) })}</span>
                  )}
                </td>
                <td className="py-2">{shortDate(row.createdAt)}</td>
                <td className="py-2 text-right">
                  <Link href={`/coordenacao/casas/resultados/${row.profileId}`} prefetch={false} className="text-link underline">
                    {text.results.openLink}
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
