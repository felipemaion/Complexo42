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
    <main className="mx-auto flex max-w-md flex-col gap-6 p-6 pt-10">
      <h1 className="text-3xl font-bold">{text.title}</h1>
      {status && (
        <p role={status === "salva" ? "status" : "alert"} className="rounded-xl border-l-4 border-primary bg-soft p-4 text-lg">
          {status === "salva" ? text.saved : text.failed}
        </p>
      )}
      <p className="text-lg">{text.intro}</p>
      <ContactVisibilityChoices visibility={visibility} action={setContactVisibilityAction} text={text} />
      <p className="text-lg">{text.leaveNote}</p>
      <ContactViewsList views={views} text={text} />
    </main>
  );
}
