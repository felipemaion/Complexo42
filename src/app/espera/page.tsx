import type { Metadata } from "next";
import Link from "next/link";
import { instance } from "@config/instance";
import { DELETE_ACCOUNT_PATH } from "@/modules/privacy";

// Tela de quem está na lista de espera (ADR 0008 §1, #26). Não lê nada do banco nem mostra
// dado de ninguém: quem está em `waitlisted` só tem o próprio perfil. O fluxo de login (#9)
// redireciona para cá quando `resolveAccessAfterSignIn` devolve `waitlisted`.
export const metadata: Metadata = { title: instance.waitlist.title };

export default function WaitlistPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-4 p-6">
      <h1 className="text-3xl font-bold">{instance.waitlist.title}</h1>
      <p className="text-lg">{instance.waitlist.message}</p>
      {/* Quem espera também pode excluir a conta (#18, LGPD art. 18, VI). Sem sessão, o link
          leva ao login. */}
      <Link href={DELETE_ACCOUNT_PATH} className="text-lg underline">
        {instance.deleteAccount.homeLink}
      </Link>
    </main>
  );
}
