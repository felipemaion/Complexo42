import type { Metadata } from "next";
import Link from "next/link";
import { instance } from "@config/instance";
import { sessionHouseClient } from "@/modules/houses";
import { SkillPicker, listCatalog, listMySuggestions, maxSkillsPerPerson, readMySkillIds, skillErrorText, skillNameLimits } from "@/modules/skills";
import { HOME_PATH } from "@/server/auth/routes";
import { requireUser } from "@/server/auth/session";
import { saveSkillsAction, suggestSkillAction } from "./actions";
import { buttonClass, cardClass, fieldClass, noticeClass, PageShell, textLinkClass } from "@/modules/ui";

export const metadata: Metadata = { title: instance.skills.title };

const big = buttonClass("secondary", "lg");

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
  const errorText = skillErrorText(text.errors, query.erro);
  const statusText = { open: text.statusOpen, approved: text.statusApproved, rejected: text.statusRejected } as const;
  return (
    <PageShell width="form">
      <h1 className="text-3xl font-bold sm:text-4xl">{text.title}</h1>
      <p className="max-w-prose text-lg text-ink-muted">{text.intro.replace("{max}", String(maxSkillsPerPerson))}</p>
      {query.salvo === "1" && (
        <p role="status" className={noticeClass("success")}>
          {text.saved}
        </p>
      )}
      {query.sugerida === "1" && (
        <p role="status" className={noticeClass("success")}>
          {text.suggested}
        </p>
      )}
      {errorText && (
        <p role="alert" className={noticeClass("error")}>
          {errorText}
        </p>
      )}
      <form action={saveSkillsAction} className={cardClass()}>
        <SkillPicker
          skills={catalog}
          selected={mine}
          max={maxSkillsPerPerson}
          text={{ searchLabel: text.searchLabel, counter: text.counter, limitReached: text.limitReached, empty: text.empty }}
        />
        <button type="submit" className={buttonClass("primary", "lg")}>
          {text.saveButton}
        </button>
      </form>
      <section className={cardClass()} aria-labelledby="suggest-title">
        <h2 id="suggest-title" className="text-2xl font-bold">
          {text.suggestTitle}
        </h2>
        <p className="text-lg text-ink-muted">{text.suggestHint}</p>
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
              className={`${fieldClass()} font-normal`}
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
              <li key={suggestion.id} className="rounded-control border border-line bg-surface p-3 text-lg" data-testid="my-suggestion">
                {suggestion.name} — {statusText[suggestion.status]}
              </li>
            ))}
          </ul>
        </section>
      )}
      <Link href={HOME_PATH} className={`${textLinkClass()} self-center`}>
        {text.backLink}
      </Link>
    </PageShell>
  );
}
