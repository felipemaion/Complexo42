import { instance } from "@config/instance";
import { AppLogo } from "@/modules/houses/components/house-shield";
import { AccountNav } from "@/modules/navigation";
import { signOut } from "@/server/auth/actions";
import { HOME_PATH } from "@/server/auth/routes";
import { requireUser } from "@/server/auth/session";

// Moldura das páginas autenticadas (#9). Toda página aqui dentro passa por requireUser
// (sessão + access_status). O cabeçalho leva ao início e à página-mãe (#205) e mostra em qual conta a pessoa está, com o e-mail
// mascarado (M1): quem foi logado na conta de outra pessoa percebe na hora.
export default async function AccountLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const user = await requireUser();
  const text = instance.auth;
  return (
    <>
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-300 px-6 py-3">
        <AppLogo name={instance.name} size={40} />
        <AccountNav homePath={HOME_PATH} labels={{ nav: text.navLabel, home: text.navHome, back: text.navBack }} />
        <p className="text-base" data-testid="connected-as">
          {text.connectedAs} <strong>{user.maskedEmail}</strong>
        </p>
        <form action={signOut}>
          <button type="submit" className="rounded-xl border-2 border-current px-5 py-3 text-lg font-semibold">
            {text.signOutButton}
          </button>
        </form>
      </header>
      {children}
    </>
  );
}
