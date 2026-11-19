import type { Metadata } from "next";
import { instance } from "@config/instance";
import { signOut } from "@/server/auth/actions";
import { requireUser } from "@/server/auth/session";

export const metadata: Metadata = { title: instance.auth.signedInTitle };

// Página inicial de quem entrou (#9). Ainda sem conteúdo: o perfil e a casa chegam em outras
// issues. O e-mail de login nunca aparece aqui (MODELO_DADOS: "nunca exibido").
export default async function SignedInHome() {
  await requireUser();
  const text = instance.auth;
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 p-6">
      <h1 className="text-3xl font-bold">{text.signedInTitle}</h1>
      <p className="text-lg">{text.signedInMessage}</p>
      <form action={signOut}>
        <button type="submit" className="w-full rounded-xl border-2 border-current px-6 py-5 text-xl font-semibold">
          {text.signOutButton}
        </button>
      </form>
    </main>
  );
}
