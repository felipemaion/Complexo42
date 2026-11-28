import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { instance } from "@config/instance";
import { COORDINATION_PATH, readCoordinationMenu } from "@/modules/access";
import { coordinationViewDeps, OwnHouse, readOwnHouseCard, sessionHouseClient } from "@/modules/houses";
import { DELETE_ACCOUNT_PATH, MY_DATA_PATH, MY_DATA_STATUS_PARAM, parseMyDataStatus } from "@/modules/privacy";
import { CONTACT_VISIBILITY_PATH, loadOwnProfile, needsFullNameNotice, SocialLinkList } from "@/modules/profiles";
import { PASSWORD_PATH, PROFILE_PATH } from "@/server/auth/routes";
import { requireUserClient } from "@/server/auth/session";
import { buttonClass, cardClass, noticeClass, PageShell, textLinkClass } from "@/modules/ui";

export const metadata: Metadata = { title: instance.auth.signedInTitle };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

// Página inicial de quem entrou (#9). Sem perfil ainda, vai direto para o formulário (#12). O
// e-mail aparece só mascarado (cabeçalho e aqui), nunca inteiro.
export default async function SignedInHome({ searchParams }: Props) {
  // A página também confere (o layout e a página renderizam em paralelo); `cache` evita repetir.
  const { user, client } = await requireUserClient();
  const own = await loadOwnProfile(client, user.id);
  if (!own) redirect(PROFILE_PATH);
  const [params, coordination] = await Promise.all([searchParams, readCoordinationMenu(client, user.id)]);
  const saved = params.salvo === "1";
  const myDataStatus = parseMyDataStatus(params[MY_DATA_STATUS_PARAM]);
  const text = instance.auth;
  const deps = coordinationViewDeps();
  const houseClient = await sessionHouseClient();
  const houseCard = houseClient && await readOwnHouseCard(houseClient, user.id, { crypto: deps.crypto, questionnaire: deps.questionnaire, houseIds: instance.houses.map((house) => house.id) });
  const action = buttonClass("secondary", "lg");
  return (
    <PageShell width="content">
      <h1 className="text-3xl font-bold sm:text-4xl">{text.signedInTitle}</h1>
      {saved && (
        <p role="status" className={noticeClass("success")}>
          {instance.profile.saved}
        </p>
      )}
      {needsFullNameNotice(own.displayName) && (
        <p role="status" className={noticeClass("info")}>
          {instance.profile.completeNameNotice}
        </p>
      )}
      {/* No computador, a casa à esquerda e as ações à direita (#324); no celular, uma coluna. */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
        <div className={cardClass()}>
          <p className="text-lg">{text.signedInMessage}</p>
          <p className="text-lg text-ink-muted">
            {text.connectedAs} <strong className="text-ink">{user.maskedEmail}</strong>
          </p>
          {/* A casa e o gráfico da pessoa, só os eixos da casa (#203). */}
          {houseCard && <OwnHouse card={houseCard} houses={instance.houses} text={instance.houseSelection} />}
          {/* Os próprios links de rede (#17), sempre pela lista segura do módulo de perfis. */}
          {own.socialLinks.length > 0 && (
            <section aria-labelledby="minhas-redes" className="flex flex-col gap-3">
              <h2 id="minhas-redes" className="text-xl font-bold">
                {instance.profile.socialLinksTitle}
              </h2>
              <SocialLinkList links={own.socialLinks} label={instance.profile.socialLinksTitle} />
            </section>
          )}
        </div>
        <div className={cardClass()}>
          <Link href={PROFILE_PATH} className={action}>
            {instance.profile.editLink}
          </Link>
          {/* Quem vê meu contato (#119, ADR 0010). */}
          <Link href={CONTACT_VISIBILITY_PATH} className={action}>
            {instance.contactVisibility.homeLink}
          </Link>
          {/* Habilidades (#15): o que a pessoa faz no dia a dia, sem nível, até 10. */}
          <Link href="/perfil/habilidades" className={action}>
            {instance.skills.homeLink}
          </Link>
          {/* Senha opcional para entrar sem e-mail (ADR 0018). */}
          <Link href={PASSWORD_PATH} className={action}>
            {instance.password.homeLink}
          </Link>
          {/* Escolha da casa de formação (#76). */}
          <Link href="/casa" className={action}>
            {instance.houseSelection.homeLink}
          </Link>
          {/* Coordenação (#26): só para quem tem papel de gestor. Conforto, não segurança (R15). */}
          {coordination.waitlist && (
            <Link href={COORDINATION_PATH} className={action}>
              {instance.coordination.homeLink}
            </Link>
          )}
          {/* "Baixar meus dados" (#20): POST para o servidor montar o arquivo; nada no navegador. */}
          <form method="post" action={MY_DATA_PATH} className="flex flex-col gap-2 border-t border-line pt-4">
            {myDataStatus && (
              <p role="alert" className={noticeClass("error")}>
                {myDataStatus === "limite" ? instance.myData.rateLimited : instance.myData.failed}
              </p>
            )}
            <button type="submit" aria-describedby="my-data-hint" className={action}>
              {instance.myData.downloadButton}
            </button>
            <p id="my-data-hint" className="text-base text-ink-muted">
              {instance.myData.downloadHint}
            </p>
          </form>
          {/* "Excluir minha conta" (#18): a página tem o aviso e a confirmação; nada é apagado aqui. */}
          <Link href={DELETE_ACCOUNT_PATH} className={textLinkClass()}>
            {instance.deleteAccount.homeLink}
          </Link>
        </div>
      </div>
    </PageShell>
  );
}
