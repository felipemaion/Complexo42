import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { instance } from "@config/instance";
import { hasOwnProfile } from "@/modules/profiles";
import { PROFILE_PATH } from "@/server/auth/routes";
import { requireUserClient } from "@/server/auth/session";

export const metadata: Metadata = { title: instance.auth.signedInTitle };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

// Página inicial de quem entrou (#9). Sem perfil ainda, vai direto para o formulário (#12). O
// e-mail aparece só mascarado (cabeçalho e aqui), nunca inteiro.
export default async function SignedInHome({ searchParams }: Props) {
  // A página também confere (o layout e a página renderizam em paralelo); `cache` evita repetir.
  const { user, client } = await requireUserClient();
  if (!(await hasOwnProfile(client, user.id))) redirect(PROFILE_PATH);
  const saved = (await searchParams).salvo === "1";
  const text = instance.auth;
  return (
    <main className="mx-auto flex max-w-md flex-col justify-center gap-6 p-6 pt-16">
      <h1 className="text-3xl font-bold">{text.signedInTitle}</h1>
      {saved && (
        <p role="status" className="rounded-lg border-2 border-current p-4 text-lg">
          {instance.profile.saved}
        </p>
      )}
      <p className="text-lg">{text.signedInMessage}</p>
      <p className="text-lg">
        {text.connectedAs} <strong>{user.maskedEmail}</strong>
      </p>
      <Link
        href={PROFILE_PATH}
        className="block w-full rounded-xl border-2 border-current px-6 py-5 text-center text-xl font-semibold focus:outline-none focus-visible:ring-4 focus-visible:ring-offset-2"
      >
        {instance.profile.editLink}
      </Link>
    </main>
  );
}
