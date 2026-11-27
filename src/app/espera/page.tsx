import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { instance } from "@config/instance";
import { DELETE_ACCOUNT_PATH } from "@/modules/privacy";
import { signOut } from "@/server/auth/actions";
import { waitlistPageRedirect } from "@/server/auth/session";
import { PageShell } from "@/modules/ui";

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
    <PageShell title={instance.waitlist.title} intro={instance.waitlist.message}>
      <form action={signOut}>
        <button type="submit" className="min-h-14 w-full rounded-xl border-2 border-current px-5 py-3 text-lg font-semibold">
          {instance.waitlist.signOutButton}
        </button>
      </form>
      {/* Quem espera também pode excluir a conta (#18, LGPD art. 18, VI). Sem sessão, o link
          leva ao login. */}
      <Link href={DELETE_ACCOUNT_PATH} className="text-lg underline">
        {instance.deleteAccount.homeLink}
      </Link>
    </PageShell>
  );
}
