import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { instance } from "@config/instance";
import { DELETE_ACCOUNT_PATH } from "@/modules/privacy";
import { signOut } from "@/server/auth/actions";
import { waitlistPageRedirect } from "@/server/auth/session";
import { buttonClass, cardClass, PageShell, textLinkClass } from "@/modules/ui";

// Tela de quem está na lista de espera (ADR 0008 §1, #26). Não lê dado de ninguém: quem está em
// `waitlisted` só tem o próprio perfil. O fluxo de login (#9) redireciona para cá quando o acesso é
// `waitlisted`. Com sessão, o portão de acesso decide (#195): quem já foi liberado vai para dentro em
// vez de ver a espera. Sem sessão, segue só o texto fixo. "Sair" encerra a sessão (a mesma ação do
// resto do app) e volta ao login, para trocar de conta.
export const metadata: Metadata = { title: instance.waitlist.title };

export default async function WaitlistPage() {
  const target = await waitlistPageRedirect();
  if (target) redirect(target);
  return (
    <PageShell width="form" isCentered>
      <div className={cardClass()}>
        <h1 className="text-3xl font-bold sm:text-4xl">{instance.waitlist.title}</h1>
        <p className="max-w-prose text-lg text-ink-muted">{instance.waitlist.message}</p>
        <form action={signOut}>
          <button type="submit" className={buttonClass("secondary", "lg")}>
            {instance.waitlist.signOutButton}
          </button>
        </form>
        {/* Quem espera também pode excluir a conta (#18, LGPD art. 18, VI). Sem sessão, o link
            leva ao login. */}
        <Link href={DELETE_ACCOUNT_PATH} className={textLinkClass()}>
          {instance.deleteAccount.homeLink}
        </Link>
      </div>
    </PageShell>
  );
}
