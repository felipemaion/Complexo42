import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { instance } from "@config/instance";
import { COORDINATION_PATH, MemberBlockForm, readCoordinationMenu } from "@/modules/access";
import { PageShell } from "@/modules/ui";
import { requireUserClient } from "@/server/auth/session";
import { memberBlockAction } from "./actions";

export const metadata: Metadata = { title: instance.coordination.memberBlock.title };

// Bloquear ou desbloquear quem já entrou (#26, ADR 0008 §1). Esconder a tela de quem não é
// gestor é só conforto: `block_member` e `unblock_member` recusam (42501) quem não pode (R15).
export default async function MemberBlockPage() {
  const { user, client } = await requireUserClient();
  if (!(await readCoordinationMenu(client, user.id)).waitlist) redirect(COORDINATION_PATH);
  const text = instance.coordination;
  return (
    <PageShell title={text.memberBlock.title} intro={text.memberBlock.intro} width="wide">
      <MemberBlockForm action={memberBlockAction} text={text.memberBlock} />
      <Link href={COORDINATION_PATH} className="text-center text-lg underline">
        {text.backLink}
      </Link>
    </PageShell>
  );
}
