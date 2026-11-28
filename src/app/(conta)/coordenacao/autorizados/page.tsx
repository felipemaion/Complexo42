import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { instance } from "@config/instance";
import { AllowlistAddEmailForm, AllowlistUploadForm, COORDINATION_PATH, readCoordinationMenu } from "@/modules/access";
import { requireUserClient } from "@/server/auth/session";
import { addAllowlistEmailAction, importAllowlistAction } from "./actions";
import { cardClass, noticeClass, PageShell, textLinkClass } from "@/modules/ui";

export const metadata: Metadata = { title: instance.coordination.allowlist.title };

// Envio da lista de autorizados (#26, ADR 0008 §1). Esconder a tela de quem não é gestor da
// raiz é só conforto: o envio chama `import_allowlist` com o JWT da pessoa, e o banco recusa
// (42501) quem não pode, o que a tela também explica.
export default async function AllowlistUploadPage() {
  const { user, client } = await requireUserClient();
  if (!(await readCoordinationMenu(client, user.id)).allowlist) redirect(COORDINATION_PATH);
  const text = instance.coordination;
  return (
    <PageShell width="content">
      <h1 className="text-3xl font-bold sm:text-4xl">{text.allowlist.title}</h1>
      <p className="max-w-prose text-lg text-ink-muted">{text.allowlist.intro}</p>
      <p className={noticeClass("info")}>{text.allowlist.privacyNote}</p>
      {/* Um e-mail ou a lista inteira: lado a lado no computador (#324). */}
      <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
        <div className={cardClass()}>
          <AllowlistAddEmailForm action={addAllowlistEmailAction} text={text.allowlist.addEmail} />
        </div>
        <div className={cardClass()}>
          <AllowlistUploadForm action={importAllowlistAction} text={text.allowlist} />
        </div>
      </div>
      <Link href={COORDINATION_PATH} className={`${textLinkClass()} self-center`}>
        {text.backLink}
      </Link>
    </PageShell>
  );
}
