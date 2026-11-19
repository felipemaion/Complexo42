import type { Metadata } from "next";
import Link from "next/link";
import { instance } from "@config/instance";

// Despedida depois de excluir a conta (#18). Pública e só com texto fixo: a sessão já foi
// encerrada e não há mais dado da pessoa para mostrar.
export const metadata: Metadata = { title: instance.deleteAccount.goodbyeTitle };

export default function AccountDeletedPage() {
  const text = instance.deleteAccount;
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-4 p-6">
      <h1 className="text-3xl font-bold">{text.goodbyeTitle}</h1>
      <p className="text-lg">{text.goodbyeMessage}</p>
      <Link href="/" className="text-lg underline">
        {text.goodbyeLink}
      </Link>
    </main>
  );
}
