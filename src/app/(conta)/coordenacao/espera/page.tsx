import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { instance } from "@config/instance";
import {
  COORDINATION_PATH,
  WAITLIST_PARAMS,
  WaitlistQueue,
  fillText,
  listWaitlist,
  municipalityNames,
  parseConfirmation,
  parseWaitlistCursor,
  parseWaitlistDone,
  readCoordinationMenu,
} from "@/modules/access";
import { requireUserClient } from "@/server/auth/session";
import { decideAccessAction } from "./actions";
import { noticeClass, PageShell, textLinkClass } from "@/modules/ui";

export const metadata: Metadata = { title: instance.coordination.waitlist.title };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const PAGE_SIZE = 20;

// Fila de espera da coordenação (#26, ADR 0008 §1). `list_waitlist` só devolve quem está no
// escopo de quem chama (R15); os nomes são decifrados aqui, no servidor (R13). E-mail e HMAC
// nunca chegam a esta tela.
export default async function WaitlistQueuePage({ searchParams }: Props) {
  const { user, client } = await requireUserClient();
  if (!(await readCoordinationMenu(client, user.id)).waitlist) redirect(COORDINATION_PATH);
  const params = await searchParams;
  const cursor = parseWaitlistCursor(params);
  const page = await listWaitlist(client, { limit: PAGE_SIZE, ...(cursor ? { after: cursor } : {}) });
  const cities = await municipalityNames(client, page.entries.map((entry) => entry.municipalityCode));
  const done = parseWaitlistDone(params[WAITLIST_PARAMS.done]);
  const text = instance.coordination;
  const date = new Intl.DateTimeFormat("pt-BR", { dateStyle: "long", timeZone: "America/Sao_Paulo" });
  const entries = page.entries.map((entry) => {
    const city = entry.municipalityCode === null ? undefined : cities.get(entry.municipalityCode);
    return {
      profileId: entry.profileId,
      // Perfil incompleto (ADR 0017): sem nome nem lugar; a pessoa aparece mesmo assim e não se libera sem identificá-la.
      displayName: entry.displayName ?? (entry.stateCode === null ? text.waitlist.incompleteProfile : text.waitlist.unknownName),
      isIdentified: entry.displayName !== null,
      place: entry.stateCode === null ? text.waitlist.incompleteProfile : city ? fillText(text.waitlist.place, { city, state: entry.stateCode }) : entry.stateCode,
      since: date.format(new Date(entry.createdAt)),
    };
  });
  return (
    <PageShell width="wide">
      <h1 className="text-3xl font-bold sm:text-4xl">{text.waitlist.title}</h1>
      {done && (
        <p role={done === "liberado" || done === "bloqueado" ? "status" : "alert"} className={noticeClass(done === "liberado" || done === "bloqueado" ? "success" : "error")}>
          {text.waitlist.done[done]}
        </p>
      )}
      <p className="max-w-prose text-lg text-ink-muted">{text.waitlist.intro}</p>
      <WaitlistQueue
        entries={entries}
        {...(cursor ? { cursor } : {})}
        nextCursor={page.nextCursor}
        confirmation={parseConfirmation(params)}
        action={decideAccessAction}
        text={text.waitlist}
      />
      <Link href={COORDINATION_PATH} className={`${textLinkClass()} self-center`}>
        {text.backLink}
      </Link>
    </PageShell>
  );
}
