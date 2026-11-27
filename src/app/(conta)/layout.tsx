import Link from "next/link";
import { instance } from "@config/instance";
import { COORDINATION_PATH, readCoordinationMenu } from "@/modules/access";
import { BADGES_PATH } from "@/modules/badges";
import { MY_TEAM_PATH, SCOREBOARD_PATH } from "@/modules/collab";
import { MISSION_REVIEW_PATH, MISSIONS_PATH, readPendingReviews, readPublishableUnits, sessionMissionClient } from "@/modules/missions";
import { PORTFOLIO_PATH } from "@/modules/portfolio";
import { DELETE_ACCOUNT_PATH, MY_DATA_PATH } from "@/modules/privacy";
import { CONTACT_VISIBILITY_PATH } from "@/modules/profiles";
import { MY_SKILLS_PATH, SEARCH_PATH, SKILLS_CATALOG_PATH } from "@/modules/search";
import { MAP_PATH } from "@/modules/map";
import { AccountNav } from "@/modules/navigation";
import { PRIOR_TEAMS_PATH, ROLES_PATH, TEAMS_PATH } from "@/modules/teams";
import { BrandMark, SoundToggle } from "@/modules/ui";
import { signOut } from "@/server/auth/actions";
import { HOME_PATH, PROFILE_PATH } from "@/server/auth/routes";
import { requireUserClient } from "@/server/auth/session";
import { log } from "@/server/log";
import { NavLinks } from "./nav-links";

// Moldura de site das páginas autenticadas (#9): faixa da demonstração, cabeçalho em duas linhas
// (marca e conta / menu em abas) e rodapé com "Minha conta". Toda página aqui dentro passa por
// requireUser (sessão + access_status). O e-mail aparece mascarado (M1): quem foi logado na conta
// de outra pessoa percebe na hora. A coordenação só aparece a quem tem papel (conforto; o banco
// decide, R15). "Voltar" para a página-mãe e "Início" ficam numa linha embaixo do menu (#205).
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
    { href: MAP_PATH, label: nav.map },
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
        {/* Celular: marca, som (só o ícone) e Sair numa linha; "Conectado como" sozinho embaixo, em
            uma linha. Computador: tudo numa linha. O e-mail mascarado fica sempre à vista (M1). */}
        <div className="mx-auto grid w-full max-w-site grid-cols-[1fr_auto_auto] items-center gap-x-2 gap-y-1 px-5 py-3 sm:flex sm:flex-wrap sm:justify-between sm:gap-x-3">
          <div className="flex min-w-0 items-center gap-3 sm:order-1">
            <BrandMark shortName={instance.shortName} />
            <div className="min-w-0">
              <p className="text-lg font-bold leading-tight text-ink">{instance.name}</p>
              <p className="hidden text-base text-ink-muted sm:block">{instance.site.tagline}</p>
            </div>
          </div>
          <div className="sm:order-3">
            <SoundToggle label={instance.site.sound} isCompactOnPhone />
          </div>
          <form action={signOut} className="sm:order-4">
            <button type="submit" className={signOutClass}>
              {instance.auth.signOutButton}
            </button>
          </form>
          <p className="col-span-3 min-w-0 text-base text-ink-muted sm:order-2 sm:ml-auto" data-testid="connected-as">
            {instance.auth.connectedAs} <strong className="text-ink">{user.maskedEmail}</strong>
          </p>
        </div>
        <NavLinks items={items} label={nav.label} />
        <div className="mx-auto w-full max-w-site px-5 pb-3">
          <AccountNav
            homePath={HOME_PATH}
            labels={{ nav: instance.auth.navLabel, home: instance.auth.navHome, back: instance.auth.navBack }}
          />
        </div>
      </header>
      <div className="flex-1">{children}</div>
      <SiteFooter coordinationLinks={isCoordinator ? coordinationLinks : []} hasWaitlist={coordination.waitlist} />
    </div>
  );
}

function DemoBar({ isCoordinator }: { readonly isCoordinator: boolean }) {
  const demo = instance.demo;
  const otherRole = isCoordinator ? demo.member : demo.coordinator;
  return (
    <div className="bg-secondary text-on-secondary">
      {/* Uma linha no celular: "Demonstração · membro" e "Trocar" (nome completo para leitor de tela). */}
      <div className="mx-auto flex w-full max-w-site items-center justify-between gap-3 px-5 text-base">
        <p>
          <strong>{demo.banner}</strong> · <span className="hidden sm:inline">{demo.viewingAs} </span>
          <strong>{isCoordinator ? demo.coordinator : demo.member}</strong>
        </p>
        {/* Link comum (recarga inteira): a troca de conta não pode reaproveitar a página em cache. */}
        <a
          href={`/demo?papel=${isCoordinator ? "membro" : "coordenacao"}`}
          aria-label={`${demo.switchTo} ${otherRole}`}
          className="inline-flex min-h-12 shrink-0 items-center font-bold text-on-secondary"
        >
          <span className="sm:hidden">{demo.switchShort}</span>
          <span className="hidden sm:inline">
            {demo.switchTo} {otherRole}
          </span>
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
// "Sair" do cabeçalho: mesma pílula de 48 px do botão de som (cabe na linha da marca no celular).
const signOutClass =
  "inline-flex min-h-12 items-center justify-center rounded-full border-2 border-line px-4 text-lg font-bold text-primary transition-[transform,border-color] duration-150 hover:border-primary active:scale-95 motion-reduce:transform-none focus-visible:ring-4 focus-visible:ring-focus focus-visible:ring-offset-2";
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
          <Link prefetch={false} href={PROFILE_PATH} className={footerLink}>{instance.profile.editLink}</Link>
          {/* Habilidades marcadas pela própria pessoa (#15). */}
          <Link prefetch={false} href={MY_SKILLS_PATH} className={footerLink}>{instance.mySkills.homeLink}</Link>
          {/* Portfólio por links (#70). */}
          <Link prefetch={false} href={PORTFOLIO_PATH} className={footerLink}>{instance.portfolio.homeLink}</Link>
          {/* Equipes de antes da plataforma (#136). */}
          <Link prefetch={false} href={PRIOR_TEAMS_PATH} className={footerLink}>{instance.priorTeams.homeLink}</Link>
          {/* Quem vê meu contato (#119, ADR 0010). */}
          <Link prefetch={false} href={CONTACT_VISIBILITY_PATH} className={footerLink}>{instance.contactVisibility.homeLink}</Link>
          <form method="post" action={MY_DATA_PATH} className="flex flex-col gap-1">
            <button type="submit" aria-describedby="my-data-hint" className={`${footerLink} cursor-pointer text-left`}>
              {instance.myData.downloadButton}
            </button>
            <p id="my-data-hint" className="text-base text-ink-muted">{instance.myData.downloadHint}</p>
          </form>
          {/* Escolha da casa de formação (#76). */}
          <Link prefetch={false} href="/casa" className={footerLink}>{instance.houseSelection.homeLink}</Link>
          {/* "Excluir minha conta" (#18): a página tem o aviso e a confirmação; nada é apagado aqui. */}
          <Link prefetch={false} href={DELETE_ACCOUNT_PATH} className={footerLink}>{instance.deleteAccount.homeLink}</Link>
        </nav>
        {(coordinationLinks.length > 0 || hasWaitlist) && (
          <nav aria-label={site.coordinationTitle} className="flex flex-col gap-3">
            <p className={footerTitle}>{site.coordinationTitle}</p>
            {coordinationLinks.map((link) => (
              <Link prefetch={false} key={link.href} href={link.href} className={footerLink}>{link.label}</Link>
            ))}
            {/* Coordenação (#26): lista de espera, só para quem tem papel de gestor (R15). */}
            {hasWaitlist && <Link prefetch={false} href={COORDINATION_PATH} className={footerLink}>{instance.coordination.homeLink}</Link>}
            {/* Catálogo de habilidades (#25): a tela avisa se a pessoa não é gestora nacional. */}
            {coordinationLinks.length > 0 && <Link prefetch={false} href={SKILLS_CATALOG_PATH} className={footerLink}>{instance.skillsCatalog.homeLink}</Link>}
          </nav>
        )}
      </div>
      <p className="border-t border-line px-5 py-5 text-center text-base text-ink-muted">{site.privacyNote}</p>
    </footer>
  );
}
