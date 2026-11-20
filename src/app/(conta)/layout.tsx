import { instance } from "@config/instance";
import { BrandMark, buttonClass } from "@/modules/ui";
import { signOut } from "@/server/auth/actions";
import { requireUser } from "@/server/auth/session";

// Moldura das páginas autenticadas (#9). Toda página aqui dentro passa por requireUser
// (sessão + access_status). O cabeçalho mostra em qual conta a pessoa está, com o e-mail
// mascarado (M1): quem foi logado na conta de outra pessoa percebe na hora.
export default async function AccountLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const user = await requireUser();
  const text = instance.auth;
  return (
    <>
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3 px-5 py-3">
          <div className="flex items-center gap-3">
            <BrandMark shortName={instance.shortName} />
            <p className="text-base text-ink-muted" data-testid="connected-as">
              {text.connectedAs} <strong>{user.maskedEmail}</strong>
            </p>
          </div>
          <form action={signOut}>
            <button type="submit" className={buttonClass("quiet", { isFullWidth: false })}>
              {text.signOutButton}
            </button>
          </form>
        </div>
      </header>
      {children}
    </>
  );
}
