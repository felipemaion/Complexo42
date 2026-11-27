import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { instance } from "@config/instance";
import { readPersonHistory, readPriorTeams, sessionTeamsClient, TEAMS_PATH } from "@/modules/teams";
import { Notice, PageShell, Tag } from "@/modules/ui";
import { requireUser } from "@/server/auth/session";
import { decryptField } from "@/server/crypto";
import { log } from "@/server/log";

export const metadata: Metadata = { title: instance.history.title };

type Props = { readonly params: Promise<{ readonly id: string }> };

const dateFormat = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "America/Sao_Paulo" });

// Histórico de equipes da pessoa (#69): equipes por onde passou e os porta-vozes de cada período.
// Só a coordenação com escopo sobre a equipe vê (o banco decide); o id da URL é validado.
export default async function PersonHistoryPage({ params }: Props) {
  await requireUser();
  const id = z.guid().safeParse((await params).id);
  if (!id.success) notFound();
  const text = instance.history;
  const prior = instance.priorTeams;
  const client = await sessionTeamsClient();
  const [rows, priorTeams] = client
    ? await Promise.all([
        readPersonHistory(client, id.data, (value, profileId) =>
          decryptField(value, { table: "profiles", column: "display_name_enc", rowId: profileId }),
        ).catch((error: unknown) => {
          log.warn("history_read_failed", { error: error instanceof Error ? error.message : "unknown" });
          return [];
        }),
        // Equipes de antes da plataforma (#136): informadas pela pessoa; uma falha aqui não derruba a página.
        readPriorTeams(client, id.data).catch((error: unknown) => {
          log.warn("prior_teams_read_failed", { error: error instanceof Error ? error.message : "unknown" });
          return [];
        }),
      ])
    : [[], []];

  return (
    <PageShell title={text.title} intro={text.intro} width="wide">
      {rows.length === 0 ? (
        <Notice tone="info">{text.empty}</Notice>
      ) : (
        <ol className="flex flex-col gap-4">
          {rows.map((row) => (
            <li key={`${row.teamId}-${row.joinedAt}`} className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-xl font-bold">{row.teamName}</h2>
                {row.leftAt === null && <Tag tone="success">{text.current}</Tag>}
              </div>
              <p className="text-lg text-ink-muted">
                {text.since} {dateFormat.format(new Date(row.joinedAt))}
                {row.leftAt && ` ${text.until} ${dateFormat.format(new Date(row.leftAt))}`}
              </p>
              <p className="text-lg">
                <strong>{text.spokespeople}:</strong> {row.spokespeople.length > 0 ? row.spokespeople.join(", ") : text.noSpokesperson}
              </p>
            </li>
          ))}
        </ol>
      )}
      {priorTeams.length > 0 && (
        <section aria-labelledby="prior-teams-title" className="flex flex-col gap-3">
          <h2 id="prior-teams-title" className="text-2xl font-bold">
            {prior.coordinationTitle}
          </h2>
          <p className="text-lg text-ink-muted">{prior.coordinationNote}</p>
          <ul className="grid gap-3 md:grid-cols-2">
            {priorTeams.map((team) => (
              <li key={team.id} className="flex flex-col gap-2 rounded-2xl border border-line bg-surface p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-lg font-bold">{team.teamName}</p>
                  <Tag>{prior.roles[team.role]}</Tag>
                </div>
                <p className="text-lg text-ink-muted">{team.period}</p>
              </li>
            ))}
          </ul>
        </section>
      )}
      <Link href={TEAMS_PATH} className="text-lg">
        {text.back}
      </Link>
    </PageShell>
  );
}
