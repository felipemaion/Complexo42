import type { Metadata } from "next";
import Link from "next/link";
import { instance } from "@config/instance";
import { COORDINATION_PATH } from "@/modules/access";
import { requireCoordinationScreen } from "@/modules/houses";
import { listOpenSuggestions, skillNameLimits } from "@/modules/skills";
import { decideSuggestionAction } from "./actions";

export const metadata: Metadata = { title: instance.skills.queue.title };

const field = "min-h-12 w-full rounded-xl border-2 border-current bg-transparent px-3 text-lg";
const button = "min-h-12 flex-1 rounded-xl border-2 border-current px-4 text-lg font-semibold";

// Sugestões de habilidade para decidir (#15): só a coordenação nacional (os outros recebem 404). Aprovar pede o
// grupo e põe a habilidade no catálogo; rejeitar só encerra. A fila mostra nome e data, sem quem sugeriu.
export default async function SkillSuggestionsPage({
  searchParams,
}: Readonly<{ searchParams: Promise<{ erro?: string; decidida?: string }> }>) {
  const { client } = await requireCoordinationScreen("skills");
  const query = await searchParams;
  const suggestions = await listOpenSuggestions(client);
  const text = instance.skills;
  const errorText = query.erro ? (text.errors[query.erro as keyof typeof text.errors] ?? text.errors.failed) : null;
  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 p-6 pt-10">
      <h1 className="text-3xl font-bold">{text.queue.title}</h1>
      <p className="text-lg">{text.queue.intro}</p>
      {query.decidida === "1" && (
        <p role="status" className="rounded-xl border-2 border-current p-3 text-lg">
          {text.queue.decided}
        </p>
      )}
      {errorText && (
        <p role="alert" className="rounded-xl border-2 border-red-700 p-4 text-lg">
          {errorText}
        </p>
      )}
      {suggestions.length === 0 ? (
        <p className="text-lg">{text.queue.empty}</p>
      ) : (
        <ul className="flex flex-col gap-4">
          {suggestions.map((suggestion) => (
            <li key={suggestion.id} className="flex flex-col gap-3 rounded-xl border-2 border-current p-4" data-testid="suggestion-row">
              <p className="text-xl font-semibold">{suggestion.name}</p>
              <form action={decideSuggestionAction} className="flex flex-col gap-3">
                <input type="hidden" name="sugestao" value={suggestion.id} />
                <label className="flex flex-col gap-1 text-lg">
                  {text.queue.categoryLabel}
                  <input name="grupo" type="text" maxLength={skillNameLimits.max} autoComplete="off" className={field} />
                </label>
                <div className="flex gap-3">
                  <button type="submit" name="decisao" value="aprovar" className={button}>
                    {text.queue.approveButton}
                  </button>
                  <button type="submit" name="decisao" value="rejeitar" formNoValidate className={button}>
                    {text.queue.rejectButton}
                  </button>
                </div>
              </form>
            </li>
          ))}
        </ul>
      )}
      <Link href={COORDINATION_PATH} className="text-center text-lg underline">
        {text.queue.backLink}
      </Link>
    </main>
  );
}
