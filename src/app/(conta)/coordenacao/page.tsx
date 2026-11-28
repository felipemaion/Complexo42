import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { instance } from "@config/instance";
import { ALLOWLIST_UPLOAD_PATH, MEMBER_BLOCK_PATH, WAITLIST_QUEUE_PATH, readCoordinationMenu } from "@/modules/access";
import { readCoordinationLinks } from "@/modules/houses";
import { HOME_PATH } from "@/server/auth/routes";
import { requireUserClient } from "@/server/auth/session";
import { buttonClass, cardClass, PageShell, textLinkClass } from "@/modules/ui";

export const metadata: Metadata = { title: instance.coordination.title };

const big = buttonClass("secondary", "lg");

// Entrada da coordenação (#26). Os atalhos seguem os papéis de quem está logado, só por
// conforto: cada tela pede ao banco, com o JWT da pessoa, e o banco recusa quem não pode (R15).
export default async function CoordinationHome() {
  const { user, client } = await requireUserClient();
  const menu = await readCoordinationMenu(client, user.id);
  if (!menu.waitlist) redirect(HOME_PATH);
  const text = instance.coordination;
  // Atalhos do questionário só para quem pode: a nacional ou um delegado (o banco responde).
  const questionnaire = await readCoordinationLinks();
  const links = instance.questionnaireCoordination;
  return (
    <PageShell width="content">
      <h1 className="text-3xl font-bold sm:text-4xl">{text.title}</h1>
      <p className="max-w-prose text-lg text-ink-muted">{text.intro}</p>
      {/* Atalhos em grade no computador (#324). */}
      <div className={`${cardClass()} sm:grid sm:grid-cols-2`}>
      <Link href={WAITLIST_QUEUE_PATH} className={big}>
        {text.waitlist.menuLink}
      </Link>
      <Link href={MEMBER_BLOCK_PATH} className={big}>
        {text.memberBlock.menuLink}
      </Link>
      {menu.allowlist && (
        <Link href={ALLOWLIST_UPLOAD_PATH} className={big}>
          {text.allowlist.menuLink}
        </Link>
      )}
      {(questionnaire.national || questionnaire.delegate) && (
        <>
          <Link href="/coordenacao/casas/resultados" className={big}>
            {links.linkResults}
          </Link>
          <Link href="/coordenacao/casas/analise" className={big}>
            {links.linkQueue}
          </Link>
        </>
      )}
      {questionnaire.national && (
        <>
          <Link href="/coordenacao/casas/delegacoes" className={big}>
            {links.linkDelegations}
          </Link>
          <Link href="/coordenacao/casas/janela" className={big}>
            {links.linkWindow}
          </Link>
          <Link href="/coordenacao/habilidades" className={big}>
            {instance.skills.queue.menuLink}
          </Link>
        </>
      )}
      </div>
      <Link href={HOME_PATH} className={`${textLinkClass()} self-center`}>
        {text.homeBackLink}
      </Link>
    </PageShell>
  );
}
