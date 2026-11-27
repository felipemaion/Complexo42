import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { instance } from "@config/instance";
import { COORDINATION_PATH, readCoordinationMenu } from "@/modules/access";
import { coordinationViewDeps, OwnHouse, readOwnHouseCard, sessionHouseClient } from "@/modules/houses";
import { DELETE_ACCOUNT_PATH, MY_DATA_PATH, MY_DATA_STATUS_PARAM, parseMyDataStatus } from "@/modules/privacy";
import { CONTACT_VISIBILITY_PATH, loadOwnProfile, SocialLinkList } from "@/modules/profiles";
import { PROFILE_PATH } from "@/server/auth/routes";
import { requireUserClient } from "@/server/auth/session";

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
  return (
    <main className="mx-auto flex max-w-md flex-col justify-center gap-6 p-6 pt-16">
      <h1 className="text-3xl font-bold">{text.signedInTitle}</h1>
      {saved && (
        <p role="status" className="rounded-lg border-2 border-current p-4 text-lg">
          {instance.profile.saved}
        </p>
      )}
      <p className="text-lg">{text.signedInMessage}</p>
      <p className="text-lg">
        {text.connectedAs} <strong>{user.maskedEmail}</strong>
      </p>
      {/* A casa e o gráfico da pessoa, só os eixos da casa (#203). */}
      {houseCard && <OwnHouse card={houseCard} houses={instance.houses} text={instance.houseSelection} chooseHref="/casa" />}
      {/* Os próprios links de rede (#17), sempre pela lista segura do módulo de perfis. */}
      {own.socialLinks.length > 0 && (
        <section aria-labelledby="minhas-redes" className="flex flex-col gap-3">
          <h2 id="minhas-redes" className="text-xl font-semibold">
            {instance.profile.socialLinksTitle}
          </h2>
          <SocialLinkList links={own.socialLinks} label={instance.profile.socialLinksTitle} />
        </section>
      )}
      <Link
        href={PROFILE_PATH}
        className="block w-full rounded-xl border-2 border-current px-6 py-5 text-center text-xl font-semibold focus:outline-none focus-visible:ring-4 focus-visible:ring-offset-2"
      >
        {instance.profile.editLink}
      </Link>
      {/* Quem vê meu contato (#119, ADR 0010). */}
      <Link
        href={CONTACT_VISIBILITY_PATH}
        className="block w-full rounded-xl border-2 border-current px-6 py-5 text-center text-xl font-semibold focus:outline-none focus-visible:ring-4 focus-visible:ring-offset-2"
      >
        {instance.contactVisibility.homeLink}
      </Link>
      {/* "Baixar meus dados" (#20): POST para o servidor montar o arquivo; nada no navegador. */}
      <form method="post" action={MY_DATA_PATH} className="flex flex-col gap-3">
        {myDataStatus && (
          <p role="alert" className="rounded-lg border-2 border-current p-4 text-lg">
            {myDataStatus === "limite" ? instance.myData.rateLimited : instance.myData.failed}
          </p>
        )}
        <button
          type="submit"
          aria-describedby="my-data-hint"
          className="block w-full rounded-xl border-2 border-current px-6 py-5 text-center text-xl font-semibold focus:outline-none focus-visible:ring-4 focus-visible:ring-offset-2"
        >
          {instance.myData.downloadButton}
        </button>
        <p id="my-data-hint" className="text-base">
          {instance.myData.downloadHint}
        </p>
      </form>
      {/* Escolha da casa de formação (#76). */}
      <Link
        href="/casa"
        className="block w-full rounded-xl border-2 border-current px-6 py-5 text-center text-xl font-semibold focus:outline-none focus-visible:ring-4 focus-visible:ring-offset-2"
      >
        {instance.houseSelection.homeLink}
      </Link>
      {/* Coordenação (#26): só para quem tem papel de gestor. Conforto, não segurança (R15). */}
      {coordination.waitlist && (
        <Link
          href={COORDINATION_PATH}
          className="block w-full rounded-xl border-2 border-current px-6 py-5 text-center text-xl font-semibold focus:outline-none focus-visible:ring-4 focus-visible:ring-offset-2"
        >
          {instance.coordination.homeLink}
        </Link>
      )}
      {/* "Excluir minha conta" (#18): a página tem o aviso e a confirmação; nada é apagado aqui. */}
      <Link href={DELETE_ACCOUNT_PATH} className="text-center text-lg underline">
        {instance.deleteAccount.homeLink}
      </Link>
    </main>
  );
}
