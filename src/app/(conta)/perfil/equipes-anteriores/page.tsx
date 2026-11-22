import type { Metadata } from "next";
import { instance } from "@config/instance";
import { MAX_PRIOR_TEAMS, PRIOR_TEAM_ROLES, readPriorTeams, sessionTeamsClient } from "@/modules/teams";
import { buttonClass, Card, inputClass, labelClass, Notice, PageShell, Tag } from "@/modules/ui";
import { requireUser } from "@/server/auth/session";
import { log } from "@/server/log";
import { addPriorTeamAction, removePriorTeamAction } from "./actions";

export const metadata: Metadata = { title: instance.priorTeams.title };

type Props = { readonly searchParams: Promise<{ readonly ok?: string; readonly erro?: string }> };

// Equipes de antes da plataforma (#136, ex-aluno): até 5, informadas pela pessoa, sem confirmação.
// Não dão acesso a nada; a coordenação do escopo vê no histórico da pessoa.
export default async function PriorTeamsPage({ searchParams }: Props) {
  const user = await requireUser();
  const text = instance.priorTeams;
  const params = await searchParams;
  const client = await sessionTeamsClient();
  const teams = client
    ? await readPriorTeams(client, user.id).catch((error: unknown) => {
        log.warn("prior_teams_read_failed", { error: error instanceof Error ? error.message : "unknown" });
        return [];
      })
    : [];
  const done = params.ok === "added" || params.ok === "removed" ? text.done[params.ok] : null;
  const error = (["invalid", "full", "not_allowed", "failed"] as const).find((key) => key === params.erro);

  return (
    <PageShell title={text.title} intro={text.intro} width="wide">
      {done && <Notice tone="success">{done}</Notice>}
      {error && <Notice tone="error">{text.errors[error]}</Notice>}
      <div className="grid gap-8 lg:grid-cols-12">
        <section aria-label={text.title} className="flex flex-col gap-4 lg:col-span-7">
          <p className="text-lg text-ink-muted">{text.selfNote}</p>
          {teams.length === 0 ? (
            <p className="text-lg text-ink-muted">{text.empty}</p>
          ) : (
            <ul className="flex flex-col gap-4">
              {teams.map((team) => (
                <li key={team.id} className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h2 className="text-xl font-bold">{team.teamName}</h2>
                    <Tag>{text.roles[team.role]}</Tag>
                  </div>
                  <p className="text-lg text-ink-muted">{team.period}</p>
                  <form action={removePriorTeamAction}>
                    <input type="hidden" name="itemId" value={team.id} />
                    <button type="submit" className={buttonClass("danger", { isFullWidth: false })}>
                      {text.removeButton}
                      <span className="sr-only">: {team.teamName}</span>
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </section>
        <div className="lg:col-span-5">
          <Card title={text.addTitle}>
            {teams.length >= MAX_PRIOR_TEAMS ? (
              <p className="text-lg text-ink-muted">{text.full}</p>
            ) : (
              <form action={addPriorTeamAction} className="flex flex-col gap-4">
                <div className="flex flex-col gap-1">
                  <label htmlFor="teamName" className={labelClass}>
                    {text.teamNameLabel}
                  </label>
                  <input id="teamName" name="teamName" type="text" required minLength={2} maxLength={80} className={inputClass} />
                </div>
                <div className="flex flex-col gap-1">
                  <label htmlFor="period" className={labelClass}>
                    {text.periodLabel}
                  </label>
                  <input id="period" name="period" type="text" required maxLength={40} className={inputClass} />
                </div>
                <div className="flex flex-col gap-1">
                  <label htmlFor="role" className={labelClass}>
                    {text.roleLabel}
                  </label>
                  <select id="role" name="role" required defaultValue="member" className={inputClass}>
                    {PRIOR_TEAM_ROLES.map((role) => (
                      <option key={role} value={role}>
                        {text.roles[role]}
                      </option>
                    ))}
                  </select>
                </div>
                <button type="submit" className={buttonClass("primary")}>
                  {text.addButton}
                </button>
              </form>
            )}
          </Card>
        </div>
      </div>
    </PageShell>
  );
}
