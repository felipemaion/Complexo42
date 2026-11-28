import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { instance } from "@config/instance";
import { sessionHouseClient } from "@/modules/houses";
import { ContactButtons, photoUrl, readContactAccess } from "@/modules/profiles";
import { readPublicProfile } from "@/modules/public-profile";
import { requireUserClient } from "@/server/auth/session";
import { decryptField } from "@/server/crypto";
import { cardClass, PageShell } from "@/modules/ui";
import { viewContactAction } from "./actions";
import { badgeViews } from "./badge-views";

export const metadata: Metadata = { title: instance.publicProfile.title, robots: { index: false, follow: false } };

// Perfil público (#305): foto, nome e as medalhas que o dono deixou visíveis, na ordem dele. Só para membro ativo; o banco
// (`public_profile`) devolve o mesmo vazio para "não existe", "inativo" e "sem permissão", e a página responde o mesmo 404.
// Contato, formação, atividade e respostas nunca passam por aqui.
export default async function PublicProfilePage({ params }: Readonly<{ params: Promise<{ id: string }> }>) {
  const { id } = await params;
  const { user, client: authClient } = await requireUserClient();
  const client = await sessionHouseClient();
  if (!client) notFound();
  const withPhoto = instance.profile.photoEnabled;
  const person = await readPublicProfile(client, id, decryptField, { withPhoto });
  if (!person) notFound();
  const text = instance.publicProfile;
  const views = await Promise.all(
    person.badges.map(async (kind) => {
      const view = badgeViews[kind];
      return { kind, node: view ? await view(client, person.id) : null };
    }),
  );
  const shown = views.filter((v) => v.node !== null);
  // Só mostra "ver contato" de OUTRA pessoa e só dos contatos que a regra libera (sem auditar nem ler o valor).
  const access = person.id === user.id ? null : await readContactAccess(authClient, person.id);
  return (
    <PageShell width="form">
      <section className={cardClass()} aria-labelledby="perfil-publico-nome">
        {person.hasPhoto && (
          // Rota protegida por sessão: o otimizador do Next não teria o cookie, então <img> comum.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photoUrl(person.id)} alt={text.photoAlt} width={96} height={128} className="h-32 w-24 rounded-control border border-line object-cover" />
        )}
        <h1 id="perfil-publico-nome" className="text-3xl font-bold sm:text-4xl">
          {person.name ?? text.unreadableName}
        </h1>
      </section>
      <section className={cardClass()} aria-labelledby="perfil-publico-medalhas">
        <h2 id="perfil-publico-medalhas" className="text-2xl font-semibold">
          {text.badgesTitle}
        </h2>
        {shown.length === 0 ? (
          <p className="text-lg text-ink-muted">{text.noBadges}</p>
        ) : (
          <ul className="flex flex-wrap gap-4" data-testid="public-badges">
            {shown.map((v) => (
              <li key={v.kind} data-badge-kind={v.kind}>
                {v.node}
              </li>
            ))}
          </ul>
        )}
      </section>
      {access && (access.whatsapp || access.social || access.email) && (
        <div className={cardClass()}>
          <ContactButtons targetId={person.id} access={access} action={viewContactAction} text={instance.contactView} />
        </div>
      )}
    </PageShell>
  );
}
