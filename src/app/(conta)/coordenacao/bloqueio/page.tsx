import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { instance } from "@config/instance";
import { COORDINATION_PATH, MemberBlockForm, readCoordinationMenu } from "@/modules/access";
import { requireUserClient } from "@/server/auth/session";
import { memberBlockAction } from "./actions";
import { cardClass, PageShell, textLinkClass } from "@/modules/ui";

export const metadata: Metadata = { title: instance.coordination.memberBlock.title };

// Bloquear ou desbloquear quem já entrou (#26, ADR 0008 §1). Esconder a tela de quem não é
// gestor é só conforto: `block_member` e `unblock_member` recusam (42501) quem não pode (R15).
export default async function MemberBlockPage() {
  const { user, client } = await requireUserClient();
  if (!(await readCoordinationMenu(client, user.id)).waitlist) redirect(COORDINATION_PATH);
  const text = instance.coordination;
  return (
    <PageShell width="form">
      <h1 className="text-3xl font-bold sm:text-4xl">{text.memberBlock.title}</h1>
      <p className="max-w-prose text-lg text-ink-muted">{text.memberBlock.intro}</p>
      <div className={cardClass()}>
        <MemberBlockForm action={memberBlockAction} text={text.memberBlock} />
      </div>
      <Link href={COORDINATION_PATH} className={`${textLinkClass()} self-center`}>
        {text.backLink}
      </Link>
    </PageShell>
  );
}
