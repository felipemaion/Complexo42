import Link from "next/link";
import { instance } from "@config/instance";
import { COORDINATION_PATH, readCoordinationMenu } from "@/modules/access";
import { BADGES_PATH } from "@/modules/badges";
import { MY_TEAM_PATH, SCOREBOARD_PATH } from "@/modules/collab";
import { MISSION_REVIEW_PATH, MISSIONS_PATH, readPendingReviews, readPublishableUnits, sessionMissionClient } from "@/modules/missions";
import { PORTFOLIO_PATH } from "@/modules/portfolio";
import { DELETE_ACCOUNT_PATH, MY_DATA_PATH } from "@/modules/privacy";
import { CONTACT_VISIBILITY_PATH } from "@/modules/profiles";
import { SEARCH_PATH } from "@/modules/search";
import { ROLES_PATH, TEAMS_PATH } from "@/modules/teams";
import { BrandMark, buttonClass } from "@/modules/ui";
import { signOut } from "@/server/auth/actions";
import { PROFILE_PATH } from "@/server/auth/routes";
import { requireUserClient } from "@/server/auth/session";
import { log } from "@/server/log";
import { NavLinks } from "./nav-links";

// Moldura de site das páginas autenticadas (#9): faixa da demonstração, cabeçalho em duas linhas
// (marca e conta / menu em abas) e rodapé com "Minha conta". Toda página aqui dentro passa por
// requireUser (sessão + access_status). O e-mail aparece mascarado (M1): quem foi logado na conta
// de outra pessoa percebe na hora. A coordenação só aparece a quem tem papel (conforto; o banco
// decide, R15).
export default async function AccountLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const { user, client } = await requireUserClient();
  const missionClient = await sessionMissionClient();
  const [publishable, coordination] = await Promise.all([
    missionClient ? readPublishableUnits(missionClient) : Promise.resolve([]),
    readCoordinationMenu(client, user.id),
  ]);
  const isCoordinator = publishable.length > 0;
  // Contador do menu: só para a coordenação. Se falhar, o menu aparece sem o número (e fica no log).
  const pending =
    isCoordinator && missionClient
      ? await readPendingReviews(missionClient).catch((error: unknown) => {
          log.warn("nav_pending_failed", { error: error instanceof Error ? error.message : "unknown" });
          return [];
        })
      : [];
  const nav = instance.nav;
  const coordinationLinks = [
    { href: TEAMS_PATH, label: nav.teams },
    { href: MISSION_REVIEW_PATH, label: nav.review, count: pending.length },
    { href: SEARCH_PATH, label: nav.search },
    { href: BADGES_PATH, label: nav.badges },
    { href: ROLES_PATH, label: nav.roles },
  ];
  const items = [
    { href: "/inicio", label: nav.home },
    { href: MISSIONS_PATH, label: nav.missions },
    { href: MY_TEAM_PATH, label: nav.myTeam },
    { href: SCOREBOARD_PATH, label: nav.scoreboard },
    ...(isCoordinator ? coordinationLinks : []),
  ];
  const isDemo = process.env.DEMO_MODE === "1";
  return (
    <div className="flex min-h-screen flex-col">
      {isDemo && <DemoBar isCoordinator={isCoordinator} />}
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex w-full max-w-site flex-wrap items-center justify-between gap-3 px-5 py-3">
          <div className="flex items-center gap-3">
            <BrandMark shortName={instance.shortName} />
            <div>
              <p className="text-lg font-bold leading-tight text-ink">{instance.name}</p>
              <p className="text-base text-ink-muted">{instance.site.tagline}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-base text-ink-muted" data-testid="connected-as">
              {instance.auth.connectedAs} <strong className="text-ink">{user.maskedEmail}</strong>
            </p>
            <form action={signOut}>
              <button type="submit" className={buttonClass("quiet", { isFullWidth: false })}>
                {instance.auth.signOutButton}
              </button>
            </form>
          </div>
        </div>
        <NavLinks items={items} label={nav.label} />
      </header>
      <div className="flex-1">{children}</div>
      <SiteFooter coordinationLinks={isCoordinator ? coordinationLinks : []} hasWaitlist={coordination.waitlist} />
    </div>
  );
}

function DemoBar({ isCoordinator }: { readonly isCoordinator: boolean }) {
  const demo = instance.demo;
  return (
    <div className="bg-secondary text-on-secondary">
      <div className="mx-auto flex w-full max-w-site flex-wrap items-center justify-between gap-2 px-5 py-2 text-base">
        <p>
          <strong>{demo.banner}:</strong> {demo.viewingAs} <strong>{isCoordinator ? demo.coordinator : demo.member}</strong>
        </p>
        {/* Link comum (recarga inteira): a troca de conta não pode reaproveitar a página em cache. */}
        <a href={`/demo?papel=${isCoordinator ? "membro" : "coordenacao"}`} className="font-bold text-on-secondary">
          {demo.switchTo} {isCoordinator ? demo.member : demo.coordinator}
        </a>
      </div>
    </div>
  );
}

type FooterProps = {
  readonly coordinationLinks: readonly { readonly href: string; readonly label: string }[];
  readonly hasWaitlist: boolean;
};

// Área de toque de 48 px também no rodapé (ata 17/11 §10: público mais velho).
const footerLink = "inline-flex min-h-12 items-center text-lg text-ink-muted no-underline hover:text-primary hover:underline";
// Títulos das colunas do rodapé não entram no sumário da página (a <nav> já tem nome).
const footerTitle = "text-lg font-bold text-primary";

// Rodapé de site: "Minha conta" (dados, contato, baixar dados, casa, excluir) fica aqui, em vez de
// botões empilhados na página inicial. "Baixar meus dados" (#20) segue como POST ao servidor.
function SiteFooter({ coordinationLinks, hasWaitlist }: FooterProps) {
  const site = instance.site;
  return (
    <footer className="mt-12 border-t border-line bg-surface">
      <div className="mx-auto grid w-full max-w-site gap-10 px-5 py-12 md:grid-cols-3">
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <BrandMark shortName={instance.shortName} />
            <p className="text-lg font-bold text-ink">{instance.name}</p>
          </div>
          <p className="text-lg text-ink-muted">{site.footerAbout}</p>
        </div>
        <nav aria-label={site.accountTitle} className="flex flex-col gap-3">
          <p className={footerTitle}>{site.accountTitle}</p>
          <Link href={PROFILE_PATH} className={footerLink}>{instance.profile.editLink}</Link>
          {/* Portfólio por links (#70). */}
          <Link href={PORTFOLIO_PATH} className={footerLink}>{instance.portfolio.homeLink}</Link>
          {/* Quem vê meu contato (#119, ADR 0010). */}
          <Link href={CONTACT_VISIBILITY_PATH} className={footerLink}>{instance.contactVisibility.homeLink}</Link>
          <form method="post" action={MY_DATA_PATH} className="flex flex-col gap-1">
            <button type="submit" aria-describedby="my-data-hint" className={`${footerLink} cursor-pointer text-left`}>
              {instance.myData.downloadButton}
            </button>
            <p id="my-data-hint" className="text-base text-ink-muted">{instance.myData.downloadHint}</p>
          </form>
          {/* Escolha da casa de formação (#76). */}
          <Link href="/casa" className={footerLink}>{instance.houseSelection.homeLink}</Link>
          {/* "Excluir minha conta" (#18): a página tem o aviso e a confirmação; nada é apagado aqui. */}
          <Link href={DELETE_ACCOUNT_PATH} className={footerLink}>{instance.deleteAccount.homeLink}</Link>
        </nav>
        {(coordinationLinks.length > 0 || hasWaitlist) && (
          <nav aria-label={site.coordinationTitle} className="flex flex-col gap-3">
            <p className={footerTitle}>{site.coordinationTitle}</p>
            {coordinationLinks.map((link) => (
              <Link key={link.href} href={link.href} className={footerLink}>{link.label}</Link>
            ))}
            {/* Coordenação (#26): lista de espera, só para quem tem papel de gestor (R15). */}
            {hasWaitlist && <Link href={COORDINATION_PATH} className={footerLink}>{instance.coordination.homeLink}</Link>}
          </nav>
        )}
      </div>
      <p className="border-t border-line px-5 py-5 text-center text-base text-ink-muted">{site.privacyNote}</p>
    </footer>
  );
}
