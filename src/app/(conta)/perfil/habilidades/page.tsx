import type { Metadata } from "next";
import Link from "next/link";
import { instance } from "@config/instance";
import { sessionHouseClient } from "@/modules/houses";
import { listCatalog, listMySuggestions, maxSkillsPerPerson, readMySkillIds, skillNameLimits, SkillPicker } from "@/modules/skills";
import { HOME_PATH } from "@/server/auth/routes";
import { requireUser } from "@/server/auth/session";
import { saveSkillsAction, suggestSkillAction } from "./actions";

export const metadata: Metadata = { title: instance.skills.title };

const big =
  "block w-full rounded-xl border-2 border-current px-6 py-5 text-center text-xl font-semibold focus:outline-none focus-visible:ring-4 focus-visible:ring-offset-2";

// Habilidades da pessoa (#15): o que ela faz no dia a dia, sem nível, até 10, em cartões por grupo com busca.
// Quem não acha a sua sugere uma; a coordenação nacional aprova antes de entrar no catálogo.
export default async function SkillsPage({
  searchParams,
}: Readonly<{ searchParams: Promise<{ salvo?: string; sugerida?: string; erro?: string }> }>) {
  const user = await requireUser();
  const client = await sessionHouseClient();
  const text = instance.skills;
  const query = await searchParams;
  const [catalog, mine, suggestions] = client
    ? await Promise.all([listCatalog(client), readMySkillIds(client, user.id), listMySuggestions(client, user.id)])
    : [[], [], []];
  const errorText = query.erro ? (text.errors[query.erro as keyof typeof text.errors] ?? text.errors.failed) : null;
  const statusText = { open: text.statusOpen, approved: text.statusApproved, rejected: text.statusRejected } as const;
  return (
    <main className="mx-auto flex max-w-xl flex-col gap-6 p-6 pt-10">
      <h1 className="text-3xl font-bold">{text.title}</h1>
      <p className="text-lg">{text.intro.replace("{max}", String(maxSkillsPerPerson))}</p>
      {query.salvo === "1" && (
        <p role="status" className="rounded-xl border-2 border-current p-3 text-lg">
          {text.saved}
        </p>
      )}
      {query.sugerida === "1" && (
        <p role="status" className="rounded-xl border-2 border-current p-3 text-lg">
          {text.suggested}
        </p>
      )}
      {errorText && (
        <p role="alert" className="rounded-xl border-2 border-red-700 p-4 text-lg">
          {errorText}
        </p>
      )}
      <form action={saveSkillsAction} className="flex flex-col gap-4">
        <SkillPicker
          skills={catalog}
          selected={mine}
          max={maxSkillsPerPerson}
          text={{ searchLabel: text.searchLabel, counter: text.counter, limitReached: text.limitReached, empty: text.empty }}
        />
        <button type="submit" className={big}>
          {text.saveButton}
        </button>
      </form>
      <section className="flex flex-col gap-3" aria-labelledby="suggest-title">
        <h2 id="suggest-title" className="text-2xl font-bold">
          {text.suggestTitle}
        </h2>
        <p className="text-lg">{text.suggestHint}</p>
        <form action={suggestSkillAction} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-lg font-semibold">
            {text.suggestLabel}
            <input
              name="nome"
              type="text"
              required
              minLength={skillNameLimits.min}
              maxLength={skillNameLimits.max}
              autoComplete="off"
              className="min-h-12 w-full rounded-xl border-2 border-current bg-transparent px-3 text-lg font-normal"
            />
          </label>
          <button type="submit" className={big}>
            {text.suggestButton}
          </button>
        </form>
      </section>
      {suggestions.length > 0 && (
        <section className="flex flex-col gap-2" aria-labelledby="my-suggestions-title">
          <h2 id="my-suggestions-title" className="text-2xl font-bold">
            {text.mySuggestionsTitle}
          </h2>
          <ul className="flex flex-col gap-2">
            {suggestions.map((suggestion) => (
              <li key={suggestion.id} className="rounded-xl border-2 border-current p-3 text-lg" data-testid="my-suggestion">
                {suggestion.name} — {statusText[suggestion.status]}
              </li>
            ))}
          </ul>
        </section>
      )}
      <Link href={HOME_PATH} className="text-center text-lg underline">
        {text.backLink}
      </Link>
    </main>
  );
}
