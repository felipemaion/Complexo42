import type { Metadata } from "next";
import { instance } from "@config/instance";
import { requireUser } from "@/server/auth/session";

export const metadata: Metadata = { title: instance.auth.signedInTitle };

// Página inicial de quem entrou (#9). Ainda sem conteúdo: o perfil e a casa chegam em outras
// issues. O e-mail aparece só mascarado (cabeçalho e aqui), nunca inteiro.
export default async function SignedInHome() {
  // A página também confere (o layout e a página renderizam em paralelo); `cache` evita repetir.
  const user = await requireUser();
  const text = instance.auth;
  return (
    <main className="mx-auto flex max-w-md flex-col justify-center gap-6 p-6 pt-16">
      <h1 className="text-3xl font-bold">{text.signedInTitle}</h1>
      <p className="text-lg">{text.signedInMessage}</p>
      <p className="text-lg">
        {text.connectedAs} <strong>{user.maskedEmail}</strong>
      </p>
    </main>
  );
}
