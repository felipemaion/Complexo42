import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { instance } from "@config/instance";
import { COORDINATION_PATH, readCoordinationMenu } from "@/modules/access";
import { DELETE_ACCOUNT_PATH, MY_DATA_PATH, MY_DATA_STATUS_PARAM, parseMyDataStatus } from "@/modules/privacy";
import { readMyBadges, sessionBadgesClient } from "@/modules/badges";
import { MY_TEAM_PATH } from "@/modules/collab";
import { listMissions, missionPath, MISSIONS_PATH, readMyRuns, readPoints, sessionMissionClient } from "@/modules/missions";
import { CONTACT_VISIBILITY_PATH, loadOwnProfile, SocialLinkList } from "@/modules/profiles";
import { buttonClass } from "@/modules/ui";
import { PROFILE_PATH } from "@/server/auth/routes";
import { requireUserClient } from "@/server/auth/session";

export const metadata: Metadata = { title: instance.auth.signedInTitle };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

// Página inicial de quem entrou (#9). Sem perfil ainda, vai direto para o formulário (#12). O
// e-mail aparece só mascarado (cabeçalho e aqui), nunca inteiro.
export default async function SignedInHome({ searchParams }: Props) {
  // A página também confere (o layout e a página renderizam em paralelo); `cache` evita repetir.
  const { user, client } = await requireUserClient();
  const own = await loadOwnProfile(client, user.id);
  if (!own) redirect(PROFILE_PATH);
  const missionClient = await sessionMissionClient();
  const badgesClient = await sessionBadgesClient();
  const [params, coordination, missions, runs, points, badges] = await Promise.all([
    searchParams,
    readCoordinationMenu(client, user.id),
    missionClient ? listMissions(missionClient) : Promise.resolve([]),
    missionClient ? readMyRuns(missionClient, user.id) : Promise.resolve(new Map()),
    missionClient ? readPoints(missionClient, user.id) : Promise.resolve({ mine: 0, team: 0 }),
    badgesClient ? readMyBadges(badgesClient, user.id) : Promise.resolve([]),
  ]);
  const activeMissions = [...runs.values()].filter((run) => run.status === "active").length;
  const saved = params.salvo === "1";
  const myDataStatus = parseMyDataStatus(params[MY_DATA_STATUS_PARAM]);
  const text = instance.auth;
  const stats = [
    { label: instance.missions.myPointsLabel, value: points.mine, href: MISSIONS_PATH },
    { label: instance.missions.teamPointsLabel, value: points.team, href: MY_TEAM_PATH },
    { label: instance.missions.runStatus.active, value: activeMissions, href: MISSIONS_PATH },
    { label: instance.badges.myTitle, value: badges.length, href: MISSIONS_PATH },
  ];
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-5 py-8">
      <h1 className="text-3xl font-bold">{text.signedInTitle}</h1>
      {saved && (
        <p role="status" className="rounded-xl border-l-4 border-primary bg-soft p-4 text-lg">
          {instance.profile.saved}
        </p>
      )}
      {/* Painel pessoal: números grandes que levam à página certa (sem ranking, ADR 0006 §6). */}
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stats.map((stat) => (
          <li key={stat.label}>
            <Link href={stat.href} className="flex h-full flex-col gap-1 rounded-2xl border border-line bg-surface p-4 no-underline">
              <span className="text-base text-ink-muted">{stat.label}</span>
              <span className="text-3xl font-bold text-primary">{stat.value}</span>
            </Link>
          </li>
        ))}
      </ul>
      <section aria-labelledby="novas-missoes" className="flex flex-col gap-3">
        <h2 id="novas-missoes" className="text-2xl font-bold">
          {instance.missions.title}
        </h2>
        {missions.length === 0 ? (
          <p className="text-lg text-ink-muted">{instance.missions.empty}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {missions.slice(0, 3).map((mission) => (
              <li key={mission.id}>
                <Link href={missionPath(mission.id)} className="flex items-center justify-between gap-3 rounded-2xl border border-line bg-surface p-4 no-underline">
                  <span className="text-lg font-semibold text-ink">{mission.title}</span>
                  <span className="shrink-0 text-lg font-bold text-primary">
                    {mission.totalPoints} {instance.missions.pointsSuffix}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        <Link href={MISSIONS_PATH} className={`${buttonClass("primary")} no-underline`}>
          {instance.missions.homeLink}
        </Link>
      </section>
      {/* Os próprios links de rede (#17), sempre pela lista segura do módulo de perfis. */}
      {own.socialLinks.length > 0 && (
        <section aria-labelledby="minhas-redes" className="flex flex-col gap-3">
          <h2 id="minhas-redes" className="text-xl font-semibold">
            {instance.profile.socialLinksTitle}
          </h2>
          <SocialLinkList links={own.socialLinks} label={instance.profile.socialLinksTitle} />
        </section>
      )}
      <Link
        href={PROFILE_PATH}
        className="block w-full rounded-xl border-2 border-primary bg-surface text-primary no-underline px-6 py-5 text-center text-xl font-semibold focus:outline-none focus-visible:ring-4 focus-visible:ring-focus focus-visible:ring-offset-2"
      >
        {instance.profile.editLink}
      </Link>
      {/* Quem vê meu contato (#119, ADR 0010). */}
      <Link
        href={CONTACT_VISIBILITY_PATH}
        className="block w-full rounded-xl border-2 border-primary bg-surface text-primary no-underline px-6 py-5 text-center text-xl font-semibold focus:outline-none focus-visible:ring-4 focus-visible:ring-focus focus-visible:ring-offset-2"
      >
        {instance.contactVisibility.homeLink}
      </Link>
      {/* "Baixar meus dados" (#20): POST para o servidor montar o arquivo; nada no navegador. */}
      <form method="post" action={MY_DATA_PATH} className="flex flex-col gap-3">
        {myDataStatus && (
          <p role="alert" className="rounded-xl border-l-4 border-primary bg-soft p-4 text-lg">
            {myDataStatus === "limite" ? instance.myData.rateLimited : instance.myData.failed}
          </p>
        )}
        <button
          type="submit"
          aria-describedby="my-data-hint"
          className="block w-full rounded-xl border-2 border-primary bg-surface text-primary no-underline px-6 py-5 text-center text-xl font-semibold focus:outline-none focus-visible:ring-4 focus-visible:ring-focus focus-visible:ring-offset-2"
        >
          {instance.myData.downloadButton}
        </button>
        <p id="my-data-hint" className="text-base">
          {instance.myData.downloadHint}
        </p>
      </form>
      {/* Escolha da casa de formação (#76). */}
      <Link
        href="/casa"
        className="block w-full rounded-xl border-2 border-primary bg-surface text-primary no-underline px-6 py-5 text-center text-xl font-semibold focus:outline-none focus-visible:ring-4 focus-visible:ring-focus focus-visible:ring-offset-2"
      >
        {instance.houseSelection.homeLink}
      </Link>
      {/* Coordenação (#26): só para quem tem papel de gestor. Conforto, não segurança (R15). */}
      {coordination.waitlist && (
        <Link
          href={COORDINATION_PATH}
          className="block w-full rounded-xl border-2 border-primary bg-surface text-primary no-underline px-6 py-5 text-center text-xl font-semibold focus:outline-none focus-visible:ring-4 focus-visible:ring-focus focus-visible:ring-offset-2"
        >
          {instance.coordination.homeLink}
        </Link>
      )}
      {/* "Excluir minha conta" (#18): a página tem o aviso e a confirmação; nada é apagado aqui. */}
      <Link href={DELETE_ACCOUNT_PATH} className="text-center text-lg underline">
        {instance.deleteAccount.homeLink}
      </Link>
    </main>
  );
}
