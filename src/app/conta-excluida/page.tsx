import type { Metadata } from "next";
import Link from "next/link";
import { instance } from "@config/instance";
import { PageShell } from "@/modules/ui";

// Despedida depois de excluir a conta (#18). Pública e só com texto fixo: a sessão já foi
// encerrada e não há mais dado da pessoa para mostrar.
export const metadata: Metadata = { title: instance.deleteAccount.goodbyeTitle };

export default function AccountDeletedPage() {
  const text = instance.deleteAccount;
  return (
    <PageShell width="form" isCentered>
      <h1 className="text-3xl font-bold sm:text-4xl">{text.goodbyeTitle}</h1>
      <p className="max-w-prose text-lg text-ink-muted">{text.goodbyeMessage}</p>
      <Link href="/" className="text-lg text-link underline">
        {text.goodbyeLink}
      </Link>
    </PageShell>
  );
}
