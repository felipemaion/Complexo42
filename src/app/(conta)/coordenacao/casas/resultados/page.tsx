import type { Metadata } from "next";
import Link from "next/link";
import { instance } from "@config/instance";
import { COORDINATION_PATH } from "@/modules/access";
import { listResults, requireCoordinationScreen } from "@/modules/houses";
import { fill, houseName, shortDate } from "../format";

export const metadata: Metadata = { title: instance.questionnaireCoordination.results.title };

const field = "min-h-12 rounded-xl border-2 border-current bg-transparent px-3 text-lg";

// Resultados do questionário (#174, ADR 0014): pessoas ativas do escopo de quem vê (nacional: todas;
// delegado: as da concessão), com casa, totem e data. Quem não tem permissão recebe 404; a RLS decide
// quem aparece. Abrir uma pessoa é registrado.
export default async function ResultsPage({ searchParams }: Readonly<{ searchParams: Promise<{ casa?: string | string[] }> }>) {
  const { client, deps } = await requireCoordinationScreen("results");
  const raw = (await searchParams).casa;
  const houseId = typeof raw === "string" && instance.houses.some((house) => house.id === raw) ? raw : undefined;
  const { rows, unreadable } = await listResults(client, deps, { houseId });
  const text = instance.questionnaireCoordination;
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 p-6 pt-10">
      <h1 className="text-3xl font-bold">{text.results.title}</h1>
      <p className="text-lg">{text.results.intro}</p>
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
        <button type="submit" className="min-h-12 rounded-xl bg-[var(--color-primary)] px-5 text-lg font-semibold text-white">
          {text.results.filterButton}
        </button>
      </form>
      {unreadable > 0 && (
        <p role="status" className="rounded-xl border-2 border-current p-3 text-lg" data-testid="unreadable">
          {fill(text.results.unreadableList, { count: unreadable })}
        </p>
      )}
      {rows.length === 0 ? (
        <p className="text-lg">{text.results.empty}</p>
      ) : (
        <table className="w-full text-left text-lg">
          <thead>
            <tr>
              <th className="py-2">{text.results.columnPerson}</th>
              <th className="py-2">{text.results.columnHouse}</th>
              <th className="py-2">{text.results.columnTotem}</th>
              <th className="py-2">{text.results.columnDate}</th>
              <th className="py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.profileId} className="border-t border-current/30" data-testid="result-row">
                <td className="py-2">{row.name ?? text.noName}</td>
                <td className="py-2">{houseName(row.houseId)}</td>
                <td className="py-2 font-semibold">{row.totem}</td>
                <td className="py-2">{shortDate(row.createdAt)}</td>
                <td className="py-2 text-right">
                  <Link href={`/coordenacao/casas/resultados/${row.profileId}`} className="underline">
                    {text.results.openLink}
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
