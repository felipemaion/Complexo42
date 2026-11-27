import type { Metadata } from "next";
import { instance } from "@config/instance";
import { confirmMagicLinkAction } from "@/server/auth/actions";
import { magicLinkParamsSchema } from "@/server/auth/flows";

export const metadata: Metadata = { title: instance.auth.confirmTitle, referrer: "no-referrer" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

// Página do link mágico (#9, M1/M5). O GET só mostra o botão: pré-visualização do e-mail ou
// antivírus que abrem o link não gastam o token, e ninguém entra na conta de outra pessoa só por
// abrir um link. O login acontece no POST do botão (server action, com checagem de origem).
export default async function ConfirmPage({ searchParams }: Props) {
  const text = instance.auth;
  const params = magicLinkParamsSchema.safeParse(await searchParams);
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 p-6">
      <h1 className="text-3xl font-bold">{text.confirmTitle}</h1>
      {params.success ? (
        <form action={confirmMagicLinkAction} className="flex flex-col gap-6">
          <p className="text-lg">{text.confirmMessage}</p>
          <input type="hidden" name="token_hash" value={params.data.token_hash} />
          <input type="hidden" name="type" value={params.data.type} />
          <button
            type="submit"
            className="block w-full rounded-xl bg-primary px-6 py-5 text-center text-xl font-bold text-on-primary focus:outline-none focus-visible:ring-4 focus-visible:ring-focus focus-visible:ring-offset-2"
          >
            {text.confirmButton}
          </button>
        </form>
      ) : (
        <p role="alert" className="rounded-xl border-l-4 border-primary bg-soft p-4 text-lg">
          {text.errors.failed}
        </p>
      )}
    </main>
  );
}
