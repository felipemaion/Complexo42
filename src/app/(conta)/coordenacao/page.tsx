import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { instance } from "@config/instance";
import { ALLOWLIST_UPLOAD_PATH, MEMBER_BLOCK_PATH, WAITLIST_QUEUE_PATH, readCoordinationMenu } from "@/modules/access";
import { readCoordinationLinks } from "@/modules/houses";
import { HOME_PATH } from "@/server/auth/routes";
import { requireUserClient } from "@/server/auth/session";

export const metadata: Metadata = { title: instance.coordination.title };

const big =
  "block w-full rounded-xl border-2 border-current px-6 py-5 text-center text-xl font-semibold focus:outline-none focus-visible:ring-4 focus-visible:ring-offset-2";

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
    <main className="mx-auto flex max-w-md flex-col gap-6 p-6 pt-10">
      <h1 className="text-3xl font-bold">{text.title}</h1>
      <p className="text-lg">{text.intro}</p>
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
      <Link href={HOME_PATH} className="text-center text-lg underline">
        {text.homeBackLink}
      </Link>
    </main>
  );
}
