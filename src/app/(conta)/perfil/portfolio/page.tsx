import type { Metadata } from "next";
import { instance } from "@config/instance";
import { PORTFOLIO_KINDS, readPortfolio, sessionPortfolioClient } from "@/modules/portfolio";
import { socialLinkRel } from "@/modules/profiles";
import { buttonClass, Card, inputClass, labelClass, Notice, PageShell, Tag } from "@/modules/ui";
import { requireUser } from "@/server/auth/session";
import { decryptField } from "@/server/crypto";
import { log } from "@/server/log";
import { addPortfolioAction, removePortfolioAction } from "./actions";

export const metadata: Metadata = { title: instance.portfolio.title };

const MAX_ITEMS = 3;
type Props = { readonly searchParams: Promise<{ readonly ok?: string; readonly erro?: string }> };

// Portfólio por links (#70, ADR 0007 §5): até 3 itens; prévia embutida só do YouTube sem cookies
// (a CSP só deixa embutir esse domínio); qualquer outro link é link comum e seguro.
export default async function PortfolioPage({ searchParams }: Props) {
  const user = await requireUser();
  const text = instance.portfolio;
  const params = await searchParams;
  const client = await sessionPortfolioClient();
  const items = client
    ? await readPortfolio(client, user.id, (value) =>
        decryptField(value, { table: "portfolio_items", column: "url_enc", rowId: user.id }),
      ).catch((error: unknown) => {
        log.warn("portfolio_read_failed", { error: error instanceof Error ? error.message : "unknown" });
        return [];
      })
    : [];
  const done = params.ok === "added" || params.ok === "removed" ? text.done[params.ok] : null;
  const error = (["invalid", "full", "not_allowed", "failed"] as const).find((key) => key === params.erro);

  return (
    <PageShell title={text.title} intro={text.intro} width="wide">
      {done && <Notice tone="success">{done}</Notice>}
      {error && <Notice tone="error">{text.errors[error]}</Notice>}
      <div className="grid gap-8 lg:grid-cols-12">
        <section aria-label={text.title} className="flex flex-col gap-4 lg:col-span-7">
          {items.length === 0 ? (
            <p className="text-lg text-ink-muted">{text.empty}</p>
          ) : (
            <ul className="flex flex-col gap-4">
              {items.map((item) => (
                <li key={item.id} className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h2 className="text-xl font-bold">{item.title}</h2>
                    <Tag>{text.kinds[item.kind]}</Tag>
                  </div>
                  {item.embedUrl && (
                    <iframe
                      src={item.embedUrl}
                      title={item.title}
                      loading="lazy"
                      sandbox="allow-scripts allow-same-origin allow-presentation"
                      referrerPolicy="strict-origin-when-cross-origin"
                      allow="encrypted-media; picture-in-picture"
                      className="aspect-video w-full rounded-xl border border-line"
                    />
                  )}
                  <a href={item.href} target="_blank" rel={socialLinkRel} className="text-lg font-semibold break-all">
                    {text.openLink}: {item.href}
                  </a>
                  <form action={removePortfolioAction}>
                    <input type="hidden" name="itemId" value={item.id} />
                    <button type="submit" className={buttonClass("danger", { isFullWidth: false })}>
                      {text.removeButton}
                      <span className="sr-only">: {item.title}</span>
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </section>
        <div className="lg:col-span-5">
          <Card title={text.addTitle}>
            {items.length >= MAX_ITEMS ? (
              <p className="text-lg text-ink-muted">{text.full}</p>
            ) : (
              <form action={addPortfolioAction} className="flex flex-col gap-4">
                <div className="flex flex-col gap-1">
                  <label htmlFor="url" className={labelClass}>
                    {text.urlLabel}
                  </label>
                  <input id="url" name="url" type="url" inputMode="url" required maxLength={2048} placeholder="https://" className={inputClass} />
                </div>
                <div className="flex flex-col gap-1">
                  <label htmlFor="title" className={labelClass}>
                    {text.titleLabel}
                  </label>
                  <input id="title" name="title" type="text" required maxLength={80} className={inputClass} />
                </div>
                <div className="flex flex-col gap-1">
                  <label htmlFor="kind" className={labelClass}>
                    {text.kindLabel}
                  </label>
                  <select id="kind" name="kind" required defaultValue="video" className={inputClass}>
                    {PORTFOLIO_KINDS.map((kind) => (
                      <option key={kind} value={kind}>
                        {text.kinds[kind]}
                      </option>
                    ))}
                  </select>
                </div>
                <button type="submit" className={buttonClass("primary")}>
                  {text.addButton}
                </button>
              </form>
            )}
          </Card>
        </div>
      </div>
    </PageShell>
  );
}
