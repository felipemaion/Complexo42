import type { Metadata } from "next";
import Link from "next/link";
import { instance } from "@config/instance";
import { COORDINATION_PATH } from "@/modules/access";
import { requireCoordinationScreen } from "@/modules/houses";
import { listOpenSuggestions, skillErrorText, skillNameLimits } from "@/modules/skills";
import { decideSuggestionAction } from "./actions";
import { buttonClass, cardClass, fieldClass, noticeClass, PageShell, textLinkClass } from "@/modules/ui";

export const metadata: Metadata = { title: instance.skills.queue.title };

const field = fieldClass();
const button = `${buttonClass("secondary")} flex-1`;

// Sugestões de habilidade para decidir (#15): só a coordenação nacional (os outros recebem 404). Aprovar pede o
// grupo e põe a habilidade no catálogo; rejeitar só encerra. A fila mostra nome e data, sem quem sugeriu.
export default async function SkillSuggestionsPage({
  searchParams,
}: Readonly<{ searchParams: Promise<{ erro?: string; decidida?: string }> }>) {
  const { client } = await requireCoordinationScreen("skills");
  const query = await searchParams;
  const suggestions = await listOpenSuggestions(client);
  const text = instance.skills;
  const errorText = skillErrorText(text.errors, query.erro);
  return (
    <PageShell width="wide">
      <h1 className="text-3xl font-bold sm:text-4xl">{text.queue.title}</h1>
      <p className="max-w-prose text-lg text-ink-muted">{text.queue.intro}</p>
      {query.decidida === "1" && (
        <p role="status" className={noticeClass("success")}>
          {text.queue.decided}
        </p>
      )}
      {errorText && (
        <p role="alert" className={noticeClass("error")}>
          {errorText}
        </p>
      )}
      {suggestions.length === 0 ? (
        <p className="text-lg">{text.queue.empty}</p>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {suggestions.map((suggestion) => (
            <li key={suggestion.id} className={cardClass()} data-testid="suggestion-row">
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
      <Link href={COORDINATION_PATH} className={`${textLinkClass()} self-center`}>
        {text.queue.backLink}
      </Link>
    </PageShell>
  );
}
