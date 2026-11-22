import type { Metadata } from "next";
import Link from "next/link";
import { instance } from "@config/instance";
import { BadgeCollection, readMyBadges, sessionBadgesClient } from "@/modules/badges";
import { decryptField } from "@/server/crypto";
import { listMissions, MissionCard, missionPath, readMyRuns, readPoints, sessionMissionClient } from "@/modules/missions";
import { Notice, PageShell } from "@/modules/ui";
import { requireUser } from "@/server/auth/session";

export const metadata: Metadata = { title: instance.missions.title };

// Lista de missões de quem participa (ADR 0006 §3, #31): as publicadas no escopo da pessoa,
// com o andamento dela e o saldo de pontos (dela e da equipe; sem ranking individual, §6).
export default async function MissionsPage() {
  const user = await requireUser();
  const text = instance.missions;
  const client = await sessionMissionClient();
  if (!client) {
    return (
      <PageShell title={text.title}>
        <Notice tone="error">{text.errors.failed}</Notice>
      </PageShell>
    );
  }
  const badgesClient = await sessionBadgesClient();
  const [missions, runs, points, badges] = await Promise.all([
    listMissions(client),
    readMyRuns(client, user.id),
    readPoints(client, user.id),
    badgesClient
      ? readMyBadges(badgesClient, user.id, (value, ownerId) =>
          decryptField(value, { table: "profiles", column: "display_name_enc", rowId: ownerId }),
        )
      : Promise.resolve([]),
  ]);
  return (
    <PageShell title={text.title} intro={text.intro} width="wide">
      {/* No computador: missões à esquerda, pontos e medalhas ao lado; no celular, uma coluna. */}
      <div className="grid gap-8 lg:grid-cols-12">
        <div className="lg:col-span-8">
          {missions.length === 0 ? (
            <Notice tone="info">{text.empty}</Notice>
          ) : (
            <ul className="grid gap-4 md:grid-cols-2">
              {missions.map((mission) => (
                <li key={mission.id}>
                  <MissionCard mission={mission} run={runs.get(mission.id)} href={missionPath(mission.id)} text={text} />
                </li>
              ))}
            </ul>
          )}
        </div>
        <aside className="flex flex-col gap-6 lg:col-span-4">
          <section aria-labelledby="pontos" className="grid grid-cols-2 gap-3">
            <h2 id="pontos" className="sr-only">
              {text.pointsTitle}
            </h2>
            <div className="rounded-2xl border border-line bg-surface p-4">
              <p className="text-base text-ink-muted">{text.myPointsLabel}</p>
              <p className="text-3xl font-bold text-primary">{points.mine}</p>
            </div>
            <div className="rounded-2xl border border-line bg-surface p-4">
              <p className="text-base text-ink-muted">{text.teamPointsLabel}</p>
              <p className="text-3xl font-bold text-primary">{points.team}</p>
            </div>
          </section>
          {/* Medalhas como coleção, sem ranking (ADR 0007 §3). */}
          <section aria-labelledby="medalhas" className="flex flex-col gap-3">
            <h2 id="medalhas" className="text-2xl font-bold">
              {instance.badges.myTitle}
            </h2>
            <BadgeCollection awards={badges} text={instance.badges} />
          </section>
        </aside>
      </div>
      <Link href="/inicio" className="text-lg">
        {instance.coordination.homeBackLink}
      </Link>
    </PageShell>
  );
}
