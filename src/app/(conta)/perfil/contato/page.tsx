import type { Metadata } from "next";
import { instance } from "@config/instance";
import {
  CONTACT_VISIBILITY_STATUS_PARAM,
  ContactViewsList,
  ContactVisibilityChoices,
  listContactViews,
  loadContactVisibility,
  parseContactVisibilityStatus,
} from "@/modules/profiles";
import { requireUserClient } from "@/server/auth/session";
import { setContactVisibilityAction } from "./actions";
import { cardClass, noticeClass, PageShell } from "@/modules/ui";

export const metadata: Metadata = { title: instance.contactVisibility.title };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

// "Quem vê meu contato" (#119, ADR 0010): a escolha de cada contato e quem já viu. Tudo lido
// no servidor com o JWT da pessoa; os nomes de quem viu são decifrados aqui.
export default async function ContactVisibilityPage({ searchParams }: Props) {
  const { user, client } = await requireUserClient();
  const [visibility, views] = await Promise.all([loadContactVisibility(client, user.id), listContactViews(client)]);
  const status = parseContactVisibilityStatus((await searchParams)[CONTACT_VISIBILITY_STATUS_PARAM]);
  const text = instance.contactVisibility;
  return (
    <PageShell width="form">
      <h1 className="text-3xl font-bold sm:text-4xl">{text.title}</h1>
      {status && (
        <p role={status === "salva" ? "status" : "alert"} className={noticeClass(status === "salva" ? "success" : "error")}>
          {status === "salva" ? text.saved : text.failed}
        </p>
      )}
      <p className="max-w-prose text-lg text-ink-muted">{text.intro}</p>
      <div className={cardClass()}>
        <ContactVisibilityChoices visibility={visibility} action={setContactVisibilityAction} text={text} />
      </div>
      <p className="max-w-prose text-lg text-ink-muted">{text.leaveNote}</p>
      <div className={cardClass()}>
        <ContactViewsList views={views} text={text} />
      </div>
    </PageShell>
  );
}
