import type { Metadata } from "next";
import { instance } from "@config/instance";
import { confirmMagicLinkAction } from "@/server/auth/actions";
import { magicLinkParamsSchema } from "@/server/auth/flows";
import { buttonClass, cardClass, noticeClass, PageShell } from "@/modules/ui";

export const metadata: Metadata = { title: instance.auth.confirmTitle, referrer: "no-referrer" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

// Página do link mágico (#9, M1/M5). O GET só mostra o botão: pré-visualização do e-mail ou
// antivírus que abrem o link não gastam o token, e ninguém entra na conta de outra pessoa só por
// abrir um link. O login acontece no POST do botão (server action, com checagem de origem).
export default async function ConfirmPage({ searchParams }: Props) {
  const text = instance.auth;
  const params = magicLinkParamsSchema.safeParse(await searchParams);
  return (
    <PageShell width="form" isCentered>
      <div className={cardClass()}>
        <h1 className="text-3xl font-bold sm:text-4xl">{text.confirmTitle}</h1>
        {params.success ? (
          <form action={confirmMagicLinkAction} className="flex flex-col gap-6">
            <p className="text-lg text-ink-muted">{text.confirmMessage}</p>
            <input type="hidden" name="token_hash" value={params.data.token_hash} />
            <input type="hidden" name="type" value={params.data.type} />
            <button type="submit" className={buttonClass("primary", "lg")}>
              {text.confirmButton}
            </button>
          </form>
        ) : (
          <p role="alert" className={noticeClass("error")}>
            {text.errors.failed}
          </p>
        )}
      </div>
    </PageShell>
  );
}
