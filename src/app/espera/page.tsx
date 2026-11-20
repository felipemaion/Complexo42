import type { Metadata } from "next";
import Link from "next/link";
import { instance } from "@config/instance";
import { DELETE_ACCOUNT_PATH } from "@/modules/privacy";
import { PageShell } from "@/modules/ui";

// Tela de quem está na lista de espera (ADR 0008 §1, #26). Não lê nada do banco nem mostra
// dado de ninguém: quem está em `waitlisted` só tem o próprio perfil. O fluxo de login (#9)
// redireciona para cá quando `resolveAccessAfterSignIn` devolve `waitlisted`.
export const metadata: Metadata = { title: instance.waitlist.title };

export default function WaitlistPage() {
  return (
    <PageShell title={instance.waitlist.title} intro={instance.waitlist.message}>
      {/* Quem espera também pode excluir a conta (#18, LGPD art. 18, VI). Sem sessão, o link
          leva ao login. */}
      <Link href={DELETE_ACCOUNT_PATH} className="text-lg underline">
        {instance.deleteAccount.homeLink}
      </Link>
    </PageShell>
  );
}
