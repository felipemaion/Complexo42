import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { instance } from "@config/instance";
import { COORDINATION_PATH, readCoordinationMenu } from "@/modules/access";
import { readManagedNews, readNewsUnits, sessionHouseClient } from "@/modules/houses";
import { requireUserClient } from "@/server/auth/session";
import { buttonClass, cardClass, fieldClass, noticeClass, PageShell, textLinkClass } from "@/modules/ui";
import { archiveNewsAction, publishNewsAction } from "./actions";

export const metadata: Metadata = { title: instance.news.admin.title };

const errorKeys = ["invalid", "forbidden", "failed"] as const;
type ErrorKey = (typeof errorKeys)[number];

function day(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

// Publicar e arquivar novidades da página inicial (#307). Quem tem papel de gestor vê a tela; quem não tem recebe 404.
// Conforto, não segurança (R15): `publish_news` e `archive_news` conferem o escopo no banco.
export default async function NewsAdminPage({ searchParams }: Readonly<{ searchParams: Promise<{ erro?: string; ok?: string }> }>) {
  const { user, client } = await requireUserClient();
  const menu = await readCoordinationMenu(client, user.id);
  const houseClient = await sessionHouseClient();
  if (!menu.waitlist || !houseClient) notFound();
  const query = await searchParams;
  const [units, news] = await Promise.all([readNewsUnits(houseClient, user.id), readManagedNews(houseClient)]);
  const text = instance.news.admin;
  const unitName = new Map(units.map((unit) => [unit.id, unit.name]));
  const error = errorKeys.find((key): key is ErrorKey => key === query.erro);
  return (
    <PageShell width="form">
      <h1 className="text-3xl font-bold sm:text-4xl">{text.title}</h1>
      <p className="max-w-prose text-lg text-ink-muted">{text.intro}</p>
      {error && (
        <p role="alert" className={noticeClass("error")}>
          {text.errors[error]}
        </p>
      )}
      {query.ok === "publicada" && (
        <p role="status" className={noticeClass("success")}>
          {text.published}
        </p>
      )}
      {query.ok === "arquivada" && (
        <p role="status" className={noticeClass("success")}>
          {text.archived}
        </p>
      )}
      {units.length === 0 ? (
        <p className={noticeClass("info")}>{text.unitsEmpty}</p>
      ) : (
        <form action={publishNewsAction} className={cardClass()}>
          <div className="flex flex-col gap-2">
            <label htmlFor="news-unit" className="text-lg font-bold">
              {text.unitLabel}
            </label>
            <select id="news-unit" name="unidade" required className={fieldClass()}>
              {units.map((unit) => (
                <option key={unit.id} value={unit.id}>
                  {unit.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-2">
            <label htmlFor="news-title" className="text-lg font-bold">
              {text.titleLabel}
            </label>
            <input id="news-title" name="titulo" type="text" required maxLength={80} autoComplete="off" className={fieldClass()} />
          </div>
          <div className="flex flex-col gap-2">
            <label htmlFor="news-body" className="text-lg font-bold">
              {text.bodyLabel}
            </label>
            <textarea id="news-body" name="texto" required maxLength={280} rows={4} className={fieldClass()} />
          </div>
          <div className="flex flex-col gap-2">
            <label htmlFor="news-link" className="text-lg font-bold">
              {text.linkLabel}
            </label>
            <input id="news-link" name="link" type="url" maxLength={300} autoComplete="off" placeholder="https://" className={fieldClass()} />
          </div>
          <div className="flex flex-col gap-2">
            <label htmlFor="news-expires" className="text-lg font-bold">
              {text.expiresLabel}
            </label>
            <input id="news-expires" name="validade" type="date" className={fieldClass()} />
          </div>
          <button type="submit" className={buttonClass("primary", "lg")}>
            {text.publishButton}
          </button>
        </form>
      )}
      <section aria-labelledby="news-list" className="flex flex-col gap-3">
        <h2 id="news-list" className="text-xl font-bold">
          {text.listTitle}
        </h2>
        {news.length === 0 ? (
          <p className="text-lg text-ink-muted">{text.empty}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {news.map((item) => (
              <li key={item.id} className={cardClass()} data-testid="news-admin-item">
                <p className="text-lg font-bold">{item.title}</p>
                <p className="text-base text-ink-muted">
                  {[unitName.get(item.unitId), day(item.publishedAt), item.expiresAt ? `até ${day(item.expiresAt)}` : null].filter(Boolean).join(" · ")}
                </p>
                <form action={archiveNewsAction}>
                  <input type="hidden" name="id" value={item.id} />
                  <button type="submit" className={buttonClass("secondary", "md")}>
                    {text.archiveButton}
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>
      <Link href={COORDINATION_PATH} className={`${textLinkClass()} self-center`}>
        {text.backLink}
      </Link>
    </PageShell>
  );
}
