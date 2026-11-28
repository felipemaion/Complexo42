import { instance } from "@config/instance";
import { AppLogo } from "@/modules/houses/components/house-shield";
import { AccountNav } from "@/modules/navigation";
import { buttonClass, pageContainerClass } from "@/modules/ui";
import { signOut } from "@/server/auth/actions";
import { HOME_PATH } from "@/server/auth/routes";
import { pendingHouseRedirect, requireUserBeforeHouse } from "@/server/auth/session";

// Moldura das páginas autenticadas (#9). Toda página aqui dentro passa por requireUser
// (sessão + access_status). O cabeçalho leva ao início e à página-mãe (#205) e mostra em qual conta a pessoa está, com o e-mail
// mascarado (M1): quem foi logado na conta de outra pessoa percebe na hora.
export default async function AccountLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // A casa é conferida por cada página (requireUser): a tela da casa também mora aqui (ADR 0017).
  const user = await requireUserBeforeHouse();
  // Sem casa a pessoa só vê a tela da casa: o menu (Início, Voltar) não leva a lugar nenhum (ADR 0017).
  const hasHouse = (await pendingHouseRedirect()) === null;
  const text = instance.auth;
  return (
    <>
      {/* Cabeçalho na largura do site (#324). No celular, "Conectado como" desce para a segunda linha. */}
      <header className="border-b border-line bg-surface">
        <div className={`${pageContainerClass("wide")} flex flex-wrap items-center gap-x-4 gap-y-2 py-3`}>
          <div className="flex items-center gap-3">
            <AppLogo name={instance.name} size={40} />
            <span aria-hidden="true" className="hidden font-display text-lg font-bold md:inline">
              {instance.shortName}
            </span>
          </div>
          {hasHouse && <AccountNav homePath={HOME_PATH} labels={{ nav: text.navLabel, home: text.navHome, back: text.navBack }} />}
          <p className="order-last basis-full text-sm text-ink-muted sm:order-none sm:ms-auto sm:basis-auto sm:text-base" data-testid="connected-as">
            {text.connectedAs} <strong className="text-ink">{user.maskedEmail}</strong>
          </p>
          <form action={signOut} className="ms-auto sm:ms-0">
            <button type="submit" className={buttonClass("secondary")}>
              {text.signOutButton}
            </button>
          </form>
        </div>
      </header>
      {children}
    </>
  );
}
