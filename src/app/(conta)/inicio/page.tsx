import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { instance } from "@config/instance";
import { readMyBadges, sessionBadgesClient } from "@/modules/badges";
import { MY_TEAM_PATH, readDashboard, readMyTeam, readTeamIdentity, readTeamMates, sessionCollabClient, TeamFlag } from "@/modules/collab";
import {
  listMissions,
  MISSION_PUBLISH_PATH,
  MISSION_REVIEW_PATH,
  missionPath,
  MISSIONS_PATH,
  readMyRuns,
  readPendingReviews,
  readPoints,
  readPublishableUnits,
  sessionMissionClient,
} from "@/modules/missions";
import { MY_DATA_STATUS_PARAM, parseMyDataStatus } from "@/modules/privacy";
import { loadOwnProfile, SocialLinkList } from "@/modules/profiles";
import { buttonClass, Notice, Tag } from "@/modules/ui";
import { PROFILE_PATH } from "@/server/auth/routes";
import { requireUserClient } from "@/server/auth/session";
import { decryptField } from "@/server/crypto";
import { log } from "@/server/log";

export const metadata: Metadata = { title: instance.auth.signedInTitle };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const cardClass = "flex flex-col gap-4 rounded-2xl border border-line bg-surface p-6";
const statClass = "flex h-full flex-col gap-2 rounded-2xl border border-line bg-surface p-5 no-underline hover:border-primary";

// Cartão secundário (equipe, painel, pendências) que falha não derruba a página inteira: o erro
// vai para o log (só o nome do cartão, sem dado pessoal) e o cartão aparece vazio.
async function orFallback<T>(read: Promise<T>, fallback: T, card: string): Promise<T> {
  try {
    return await read;
  } catch (error: unknown) {
    log.warn("home_card_failed", { card, error: error instanceof Error ? error.message : "unknown" });
    return fallback;
  }
}

function initials(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map((word) => word.charAt(0)).join("").toUpperCase();
}

// Página inicial de quem entrou (#9), em formato de painel de site: faixa de destaque, quatro
// números, missões ao lado da equipe e das medalhas, e (só coordenação) pontos por equipe e
// entregas esperando validação. Sem perfil ainda, vai direto para o formulário (#12). Sem ranking
// de pessoas (ADR 0006 §6). "Minha conta" fica no rodapé da moldura.
export default async function SignedInHome({ searchParams }: Props) {
  const { user, client } = await requireUserClient();
  const own = await loadOwnProfile(client, user.id);
  if (!own) redirect(PROFILE_PATH);
  const [missionClient, badgesClient, collabClient] = await Promise.all([
    sessionMissionClient(),
    sessionBadgesClient(),
    sessionCollabClient(),
  ]);
  const [params, missions, runs, points, publishable, badges, team] = await Promise.all([
    searchParams,
    missionClient ? listMissions(missionClient) : Promise.resolve([]),
    missionClient ? readMyRuns(missionClient, user.id) : Promise.resolve(new Map()),
    missionClient ? readPoints(missionClient, user.id) : Promise.resolve({ mine: 0, team: 0 }),
    missionClient ? readPublishableUnits(missionClient) : Promise.resolve([]),
    badgesClient ? readMyBadges(badgesClient, user.id) : Promise.resolve([]),
    collabClient ? orFallback(readMyTeam(collabClient), null, "team") : Promise.resolve(null),
  ]);
  const isCoordinator = publishable.length > 0;
  const [mates, pending, dashboard, identity] = await Promise.all([
    collabClient && team
      ? orFallback(
          readTeamMates(collabClient, team.teamId, (value, profileId) =>
            decryptField(value, { table: "profiles", column: "display_name_enc", rowId: profileId }),
          ),
          [],
          "mates",
        )
      : Promise.resolve([]),
    isCoordinator && missionClient ? orFallback(readPendingReviews(missionClient), [], "pending") : Promise.resolve([]),
    isCoordinator && collabClient ? orFallback(readDashboard(collabClient), [], "dashboard") : Promise.resolve([]),
    collabClient && team ? orFallback(readTeamIdentity(collabClient, team.teamId), null, "identity") : Promise.resolve(null),
  ]);

  const site = instance.site;
  const text = instance.missions;
  const saved = params.salvo === "1";
  const myDataStatus = parseMyDataStatus(params[MY_DATA_STATUS_PARAM]);
  const firstName = own.displayName.trim().split(/\s+/)[0] ?? "";
  const activeCount = [...runs.values()].filter((run) => run.status === "active").length;
  const lead = mates.find((mate) => mate.isLead);
  const maxTeamPoints = Math.max(1, ...dashboard.map((row) => row.teamPoints));
  // Coordenação sem equipe própria: o destaque mostra o que espera por ela, não "0 pontos".
  const highlight = team || !isCoordinator
    ? { label: text.teamPointsLabel, value: points.team, foot: team ? `${team.teamName} · ${mates.length} ${site.peopleSuffix}` : null }
    : { label: site.pendingLabel, value: pending.length, foot: null };
  const stats = [
    { label: text.myPointsLabel, value: points.mine, href: MISSIONS_PATH },
    { label: text.runStatus.active, value: activeCount, href: MISSIONS_PATH },
    isCoordinator
      ? { label: site.pendingLabel, value: pending.length, href: MISSION_REVIEW_PATH }
      : { label: site.availableLabel, value: missions.filter((mission) => !runs.has(mission.id)).length, href: MISSIONS_PATH },
    { label: instance.badges.myTitle, value: badges.length, href: MISSIONS_PATH },
  ];
  const actions = isCoordinator
    ? [
        { href: MISSION_REVIEW_PATH, label: instance.nav.review, variant: "primary" as const },
        { href: MISSION_PUBLISH_PATH, label: text.publish.menuLink, variant: "secondary" as const },
      ]
    : [
        { href: MISSIONS_PATH, label: instance.nav.missions, variant: "primary" as const },
        { href: MY_TEAM_PATH, label: instance.nav.myTeam, variant: "secondary" as const },
      ];

  return (
    <main className="flex w-full flex-col">
      {/* Avisos no topo: quem clicou em "Baixar meus dados" no rodapé vê o resultado logo de cara. */}
      {(saved || myDataStatus) && (
        <div className="mx-auto flex w-full max-w-site flex-col gap-3 px-5 pt-6">
          {saved && <Notice tone="success">{instance.profile.saved}</Notice>}
          {myDataStatus && (
            <p role="alert" className="rounded-xl border-l-4 border-danger bg-danger-soft p-4 text-lg">
              {myDataStatus === "limite" ? instance.myData.rateLimited : instance.myData.failed}
            </p>
          )}
        </div>
      )}
      {/* Faixa de destaque na largura toda. */}
      <section className="border-b border-line bg-linear-to-br from-surface to-canvas">
        <div className="mx-auto grid w-full max-w-site gap-8 px-5 py-12 lg:grid-cols-[1fr_380px] lg:items-center">
          <div className="flex flex-col gap-4">
            <p className="text-base font-bold uppercase tracking-wider text-primary">{site.kicker}</p>
            <h1 className="text-4xl font-bold leading-tight text-ink sm:text-5xl">
              {site.greeting}, {firstName}
            </h1>
            <p className="max-w-2xl text-xl text-ink-muted">{isCoordinator ? site.coordinatorIntro : site.memberIntro}</p>
            <div className="flex flex-wrap gap-3">
              {actions.map((action) => (
                <Link key={action.href} href={action.href} className={`${buttonClass(action.variant, { isFullWidth: false })} no-underline`}>
                  {action.label}
                </Link>
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-2 rounded-2xl border border-primary bg-soft p-6">
            <span className="text-base text-ink-muted">{highlight.label}</span>
            <span className="text-6xl font-bold leading-none text-primary">{highlight.value}</span>
            {highlight.foot && <span className="mt-4 border-t border-line pt-4 text-base text-ink-muted">{highlight.foot}</span>}
          </div>
        </div>
      </section>

      <div className="mx-auto flex w-full max-w-site flex-col gap-10 px-5 py-10">
        {/* Quatro números que levam à página certa. */}
        <ul className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {stats.map((stat) => (
            <li key={stat.label}>
              <Link href={stat.href} className={statClass}>
                <span className="text-base text-ink-muted">{stat.label}</span>
                <span className="text-4xl font-bold text-ink">{stat.value}</span>
              </Link>
            </li>
          ))}
        </ul>

        <div className="grid gap-8 lg:grid-cols-12">
          <section aria-labelledby="missoes-abertas" className="flex flex-col gap-5 lg:col-span-8">
            <div className="flex items-center justify-between gap-4">
              <h2 id="missoes-abertas" className="text-2xl font-bold">
                {site.openMissionsTitle}
              </h2>
              <Link href={MISSIONS_PATH} className="text-lg font-semibold">
                {site.seeAll}
              </Link>
            </div>
            {/* Texto comum (não role=status): o único aviso da página é o de "salvo". */}
            {missions.length === 0 ? (
              <p className="text-lg text-ink-muted">{text.empty}</p>
            ) : (
              <ul className="flex flex-col gap-4">
                {missions.slice(0, 4).map((mission) => {
                  const run = runs.get(mission.id);
                  return (
                    <li key={mission.id}>
                      <Link href={missionPath(mission.id)} className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-5 no-underline hover:border-primary">
                        <span className="flex items-start justify-between gap-4">
                          <span className="text-xl font-bold text-ink">{mission.title}</span>
                          <Tag tone="primary">
                            {mission.totalPoints} {text.pointsSuffix}
                          </Tag>
                        </span>
                        <span className="flex flex-wrap items-center gap-2">
                          <Tag>{text.mode[mission.mode]}</Tag>
                          <Tag>{text.origin[mission.origin]}</Tag>
                          {run?.status === "active" && <Tag tone="warning">{text.runStatus.active}</Tag>}
                          {run?.status === "completed" && <Tag tone="success">{text.runStatus.completed}</Tag>}
                          {!run && <Tag>{site.available}</Tag>}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <div className="flex flex-col gap-6 lg:col-span-4">
            {(team || !isCoordinator) && (
              <section className={cardClass}>
                <h2 className="text-2xl font-bold">{instance.myTeam.title}</h2>
                {team ? (
                  <>
                    <div className="flex items-center gap-3">
                      {identity && <TeamFlag identity={identity} label={`${instance.teamIdentity.flagLabel}: ${team.teamName}`} size="small" />}
                      <div className="flex flex-col">
                        <p className="text-xl font-bold text-ink">{team.teamName}</p>
                        {identity?.motto && <p className="text-base text-primary">{identity.motto}</p>}
                      </div>
                    </div>
                    {lead && (
                      <p className="text-lg text-ink-muted">
                        {site.leadLabel}: {lead.displayName}
                      </p>
                    )}
                    <ul className="flex flex-wrap gap-2">
                      {mates.slice(0, 8).map((mate) => (
                        <li
                          key={mate.profileId}
                          title={mate.displayName}
                          className="flex h-11 w-11 items-center justify-center rounded-full border border-line bg-soft text-base font-bold text-primary"
                        >
                          {initials(mate.displayName)}
                        </li>
                      ))}
                    </ul>
                    <Link href={MY_TEAM_PATH} className={`${buttonClass("secondary")} no-underline`}>
                      {site.openTeam}
                    </Link>
                  </>
                ) : (
                  <p className="text-lg text-ink-muted">{instance.myTeam.noTeam}</p>
                )}
              </section>
            )}

            <section className={cardClass}>
              <h2 className="text-2xl font-bold">{instance.badges.myTitle}</h2>
              {badges.length === 0 ? (
                <p className="text-lg text-ink-muted">{instance.badges.empty}</p>
              ) : (
                <ul className="flex flex-col gap-3">
                  {badges.slice(0, 5).map((badge) => (
                    <li key={badge.awardId} className="flex items-center gap-3">
                      <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-secondary font-bold text-on-secondary">
                        {badge.name.trim().charAt(0).toUpperCase()}
                      </span>
                      <span className="flex flex-col">
                        <span className="font-semibold text-ink">{badge.name}</span>
                        <span className="text-base text-ink-muted">{badge.reason}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* Os próprios links de rede (#17), sempre pela lista segura do módulo de perfis. */}
            {own.socialLinks.length > 0 && (
              <section className={cardClass}>
                <h2 className="text-2xl font-bold">{instance.profile.socialLinksTitle}</h2>
                <SocialLinkList links={own.socialLinks} label={instance.profile.socialLinksTitle} />
              </section>
            )}
          </div>
        </div>

        {isCoordinator && (
          <div className="grid gap-8 lg:grid-cols-2">
            {/* Números por equipe (#49), na ordem do banco: sem ranking de pessoas. */}
            <section className={cardClass}>
              <h2 className="text-2xl font-bold">{site.teamPointsTitle}</h2>
              {dashboard.length === 0 ? (
                <p className="text-lg text-ink-muted">{instance.dashboard.empty}</p>
              ) : (
                <ul className="flex flex-col gap-5">
                  {dashboard.map((row) => (
                    <li key={row.teamId} className="flex flex-col gap-2">
                      <span className="flex items-center justify-between gap-4">
                        <span className="font-bold text-ink">{row.teamName}</span>
                        <span className="font-bold text-primary">
                          {row.teamPoints} {text.pointsSuffix}
                        </span>
                      </span>
                      <span aria-hidden="true" className="block h-2 w-full rounded-full bg-soft">
                        <span className="block h-2 rounded-full bg-primary" style={{ width: `${(row.teamPoints / maxTeamPoints) * 100}%` }} />
                      </span>
                      <span className="text-base text-ink-muted">
                        {instance.dashboard.membersLabel}: {row.memberCount} · {instance.dashboard.activeLabel}: {row.activeRuns}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className={cardClass}>
              <h2 className="text-2xl font-bold">{site.pendingTitle}</h2>
              {pending.length === 0 ? (
                <p className="text-lg text-ink-muted">{site.pendingEmpty}</p>
              ) : (
                <>
                  <ul className="flex flex-col">
                    {pending.slice(0, 4).map((item) => (
                      <li key={item.submissionId} className="flex items-start justify-between gap-4 border-b border-line py-3 last:border-b-0">
                        <span className="flex flex-col">
                          <span className="font-bold text-ink">{item.missionTitle}</span>
                          <span className="text-base text-ink-muted">
                            {item.stepTitle} · {item.unitName}
                          </span>
                        </span>
                        <span className="shrink-0 font-bold text-primary">
                          +{item.stepPoints} {text.pointsSuffix}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <Link href={MISSION_REVIEW_PATH} className={`${buttonClass("primary")} no-underline`}>
                    {instance.nav.review}
                  </Link>
                </>
              )}
            </section>
          </div>
        )}
      </div>
    </main>
  );
}
