import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { instance } from "@config/instance";
import { AllowlistUploadForm, COORDINATION_PATH, readCoordinationMenu } from "@/modules/access";
import { PageShell } from "@/modules/ui";
import { requireUserClient } from "@/server/auth/session";
import { importAllowlistAction } from "./actions";

export const metadata: Metadata = { title: instance.coordination.allowlist.title };

// Envio da lista de autorizados (#26, ADR 0008 §1). Esconder a tela de quem não é gestor da
// raiz é só conforto: o envio chama `import_allowlist` com o JWT da pessoa, e o banco recusa
// (42501) quem não pode, o que a tela também explica.
export default async function AllowlistUploadPage() {
  const { user, client } = await requireUserClient();
  if (!(await readCoordinationMenu(client, user.id)).allowlist) redirect(COORDINATION_PATH);
  const text = instance.coordination;
  return (
    <PageShell title={text.allowlist.title} intro={text.allowlist.intro} width="wide">
      <p className="text-lg">{text.allowlist.privacyNote}</p>
      <AllowlistUploadForm action={importAllowlistAction} text={text.allowlist} />
      <Link href={COORDINATION_PATH} className="text-center text-lg underline">
        {text.backLink}
      </Link>
    </PageShell>
  );
}
