import type { Metadata } from "next";
import Link from "next/link";
import { instance } from "@config/instance";
import { parsePeriod, readScoreboard, SCOREBOARD_PATH, SCOREBOARD_PERIODS, sessionCollabClient } from "@/modules/collab";
import { PageShell, Tag } from "@/modules/ui";
import { requireUser } from "@/server/auth/session";
import { log } from "@/server/log";

export const metadata: Metadata = { title: instance.scoreboard.title };

type Props = { readonly searchParams: Promise<{ readonly periodo?: string }> };

// Placar das equipes da região (#58, ADR 0006 §6): competição entre equipes, sem ranking de pessoas.
export default async function ScoreboardPage({ searchParams }: Props) {
  await requireUser();
  const text = instance.scoreboard;
  const days = parsePeriod((await searchParams).periodo);
  const client = await sessionCollabClient();
  const rows = client
    ? await readScoreboard(client, days).catch((error: unknown) => {
        log.warn("scoreboard_read_failed", { error: error instanceof Error ? error.message : "unknown" });
        return [];
      })
    : [];
  const max = Math.max(1, ...rows.map((row) => row.points));
  const periods = [...SCOREBOARD_PERIODS.map((value) => ({ value: String(value), label: text.periods[String(value) as "7" | "30" | "90"] })), { value: "", label: text.periods.all }];
  const current = days === null ? "" : String(days);

  return (
    <PageShell title={text.title} intro={text.intro} width="wide">
      <nav aria-label={text.periodLabel} className="flex flex-wrap gap-2">
        {periods.map((period) => (
          <Link
            key={period.value || "all"}
            href={period.value ? `${SCOREBOARD_PATH}?periodo=${period.value}` : SCOREBOARD_PATH}
            aria-current={period.value === current ? "page" : undefined}
            className={`inline-flex min-h-12 items-center rounded-full border-2 px-4 text-lg font-semibold no-underline ${
              period.value === current ? "border-primary bg-primary text-on-primary" : "border-line bg-surface text-primary"
            }`}
          >
            {period.label}
          </Link>
        ))}
      </nav>
      {rows.length === 0 ? (
        <p className="text-lg text-ink-muted">{text.empty}</p>
      ) : (
        <ol className="flex flex-col gap-3">
          {rows.map((row) => (
            <li
              key={row.teamId}
              className={`flex flex-col gap-3 rounded-2xl border bg-surface p-5 ${row.isMine ? "border-primary" : "border-line"}`}
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="flex items-center gap-4">
                  <span className="text-3xl font-bold text-primary">{row.position}º</span>
                  <span className="text-xl font-bold text-ink">{row.teamName}</span>
                  {row.isMine && <Tag tone="primary">{text.mine}</Tag>}
                </span>
                <span className="text-2xl font-bold text-primary">
                  {row.points} {instance.missions.pointsSuffix}
                </span>
              </div>
              <span aria-hidden="true" className="block h-3 w-full rounded-full bg-soft">
                <span className="block h-3 rounded-full bg-primary" style={{ width: `${(row.points / max) * 100}%` }} />
              </span>
            </li>
          ))}
        </ol>
      )}
    </PageShell>
  );
}
