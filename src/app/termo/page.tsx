import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { consentTerm } from "@config/consent";
import { instance } from "@config/instance";
import { ConsentForm, ConsentTermView } from "@/modules/privacy";
import { signOut } from "@/server/auth/actions";
import { consentRedirect } from "@/server/auth/consent";
import { HOME_PATH } from "@/server/auth/routes";
import { requireAccessUserClient } from "@/server/auth/session";
import { acceptConsentAction } from "./actions";

export const metadata: Metadata = { title: consentTerm.title };

// Termo de consentimento (#11): a tela que vem antes do perfil. Fora do grupo `(conta)` para não
// cair no próprio portão. Quem já aceitou a versão atual segue para a página inicial.
export default async function ConsentPage() {
  const { user, client } = await requireAccessUserClient();
  if ((await consentRedirect(client, user.id)) === null) redirect(HOME_PATH);
  return (
    <main className="mx-auto flex max-w-xl flex-col gap-8 p-6 pt-10">
      <ConsentTermView term={consentTerm} />
      <ConsentForm action={acceptConsentAction} term={consentTerm} />
      <form action={signOut}>
        <button type="submit" className="w-full rounded-xl px-6 py-4 text-center text-lg underline">
          {consentTerm.declineButton}
        </button>
      </form>
      <p className="text-base">{instance.name}</p>
    </main>
  );
}
