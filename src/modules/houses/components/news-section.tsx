// A área de novidades da página inicial (#307). Só apresentação: o que mostrar é decidido por domain/news-feed.ts. Texto
// puro (o React escapa), link só https que já passou pela regra, aberto com `noopener noreferrer`. Sem novidade, nada.
import Link from "next/link";
import type { InstanceConfig } from "@/modules/instance";
import { cardClass, textLinkClass } from "@/modules/ui";
import type { NewsEntry } from "../domain/news-feed";

type Props = { entries: readonly NewsEntry[]; text: InstanceConfig["news"] };

export function NewsSection({ entries, text }: Readonly<Props>) {
  if (entries.length === 0) return null;
  return (
    <section aria-labelledby="news-title" className={cardClass()} data-testid="news">
      <h2 id="news-title" className="text-xl font-bold">
        {text.title}
      </h2>
      <ul className="flex flex-col gap-4">
        {entries.map((entry) =>
          entry.kind === "house_window" ? (
            <li key="house-window" className="flex flex-col gap-1" data-testid="news-house-window">
              <h3 className="text-lg font-semibold">{text.windowOpenTitle}</h3>
              <p className="text-lg text-ink-muted">{text.windowOpenBody}</p>
              <Link href="/casa" className={textLinkClass()}>
                {text.windowOpenLink}
              </Link>
            </li>
          ) : (
            <li key={entry.id} className="flex flex-col gap-1" data-testid="news-item">
              <h3 className="text-lg font-semibold">{entry.title}</h3>
              <p className="text-lg text-ink-muted">{entry.body}</p>
              {entry.link && (
                <a href={entry.link} target="_blank" rel="noopener noreferrer" className={textLinkClass()}>
                  {text.linkLabel}
                </a>
              )}
            </li>
          ),
        )}
      </ul>
    </section>
  );
}
