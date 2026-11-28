import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { consentTerm } from "@config/consent";
import { instance } from "@config/instance";
import { ConsentForm, ConsentTermView, DELETE_ACCOUNT_PATH, MY_DATA_PATH } from "@/modules/privacy";
import { signOut } from "@/server/auth/actions";
import { consentRedirect } from "@/server/auth/consent";
import { HOME_PATH } from "@/server/auth/routes";
import { requireAccessUserClient } from "@/server/auth/session";
import { cardClass, PageShell, textLinkClass } from "@/modules/ui";
import { acceptConsentAction } from "./actions";

export const metadata: Metadata = { title: consentTerm.title };

// Termo de consentimento (#11): a tela que vem antes do perfil. Fora do grupo `(conta)` para não
// cair no próprio portão. Quem já aceitou a versão atual segue para a página inicial.
export default async function ConsentPage() {
  const { user, client } = await requireAccessUserClient();
  if ((await consentRedirect(client, user.id)) === null) redirect(HOME_PATH);
  return (
    <PageShell width="form">
      <div className={cardClass()}>
        <ConsentTermView term={consentTerm} />
      </div>
      <div className={cardClass()}>
        <ConsentForm action={acceptConsentAction} term={consentTerm} />
        <form action={signOut}>
          <button type="submit" className={`${textLinkClass()} w-full`}>
            {consentTerm.declineButton}
          </button>
        </form>
      </div>
      {/* Os direitos do titular não dependem do aceite (LGPD art. 18): baixar os dados e excluir a conta. */}
      <section aria-label={consentTerm.rightsTitle} className="flex flex-col items-center gap-1 sm:flex-row sm:justify-center sm:gap-6">
        <form method="post" action={MY_DATA_PATH}>
          <button type="submit" className={textLinkClass()}>
            {instance.myData.downloadButton}
          </button>
        </form>
        <Link href={DELETE_ACCOUNT_PATH} className={textLinkClass()}>
          {instance.deleteAccount.homeLink}
        </Link>
      </section>
      <p className="text-center text-base text-ink-muted">{instance.name}</p>
    </PageShell>
  );
}
