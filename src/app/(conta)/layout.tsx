import { instance } from "@config/instance";
import { BADGES_PATH } from "@/modules/badges";
import { MY_TEAM_PATH } from "@/modules/collab";
import { MISSION_REVIEW_PATH, MISSIONS_PATH, readPublishableUnits, sessionMissionClient } from "@/modules/missions";
import { SEARCH_PATH } from "@/modules/search";
import { TEAMS_PATH } from "@/modules/teams";
import { BrandMark, buttonClass } from "@/modules/ui";
import { signOut } from "@/server/auth/actions";
import { requireUser } from "@/server/auth/session";
import { NavLinks } from "./nav-links";

// Moldura das páginas autenticadas (#9). Toda página aqui dentro passa por requireUser
// (sessão + access_status). O cabeçalho mostra em qual conta a pessoa está, com o e-mail
// mascarado (M1): quem foi logado na conta de outra pessoa percebe na hora.
// O menu mostra a coordenação só a quem tem papel de validar (conforto; o banco decide, R15).
export default async function AccountLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const user = await requireUser();
  const text = instance.auth;
  const nav = instance.nav;
  const missionClient = await sessionMissionClient();
  const isCoordinator = missionClient ? (await readPublishableUnits(missionClient)).length > 0 : false;
  const items = [
    { href: "/inicio", label: nav.home },
    { href: MISSIONS_PATH, label: nav.missions },
    { href: MY_TEAM_PATH, label: nav.myTeam },
    ...(isCoordinator
      ? [
          { href: TEAMS_PATH, label: nav.teams },
          { href: MISSION_REVIEW_PATH, label: nav.review },
          { href: SEARCH_PATH, label: nav.search },
          { href: BADGES_PATH, label: nav.badges },
        ]
      : []),
  ];
  const isDemo = process.env.DEMO_MODE === "1";
  return (
    <>
      {isDemo && (
        <div className="bg-secondary text-ink">
          <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-2 px-5 py-2 text-base">
            <p>
              <strong>{instance.demo.banner}:</strong> {instance.demo.viewingAs}{" "}
              <strong>{isCoordinator ? instance.demo.coordinator : instance.demo.member}</strong>
            </p>
            {/* Link comum (recarga inteira): a troca de conta não pode reaproveitar a página em cache. */}
            <a href={`/demo?papel=${isCoordinator ? "membro" : "coordenacao"}`} className="font-bold text-ink">
              {instance.demo.switchTo} {isCoordinator ? instance.demo.member : instance.demo.coordinator}
            </a>
          </div>
        </div>
      )}
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3 px-5 py-3">
          <div className="flex items-center gap-3">
            <BrandMark shortName={instance.shortName} />
            <div>
              <p className="text-lg font-bold leading-tight text-ink">{instance.name}</p>
              <p className="text-base text-ink-muted" data-testid="connected-as">
                {text.connectedAs} <strong>{user.maskedEmail}</strong>
              </p>
            </div>
          </div>
          <form action={signOut}>
            <button type="submit" className={buttonClass("quiet", { isFullWidth: false })}>
              {text.signOutButton}
            </button>
          </form>
        </div>
        <NavLinks items={items} label={nav.label} />
      </header>
      {children}
    </>
  );
}
