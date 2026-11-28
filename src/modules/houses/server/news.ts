// Leitor das novidades da página inicial (#307), com o cliente da sessão. A RLS de `news` já recorta pelo nível da
// pessoa (a unidade dela e as de cima), tira as arquivadas e as vencidas; aqui só se pedem as mais novas e se
// confere a forma. Só o código do erro sobe, nunca a mensagem do banco.
import "server-only";
import { z } from "zod";
import { log } from "@/server/log";
import { buildNewsFeed, newsFeedLimit, type NewsEntry, type NewsItem } from "../domain/news-feed";
import type { HouseClient } from "../types";
import { readTransferWindow } from "./houses";

/** O teto pedido ao banco. */
export const newsLimit = newsFeedLimit;

const rows = z.array(
  z.object({
    id: z.string().min(1),
    title: z.string(),
    body: z.string(),
    link: z.string().nullable(),
    published_at: z.string(),
  }),
);

function errorCode(error: unknown): string {
  const code = typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;
  return typeof code === "string" && /^[A-Za-z0-9_]{1,12}$/.test(code) ? code : "failed";
}

/**
 * O que a página inicial mostra na área de novidades: o cartão da janela (do estado dela) e as publicadas. Falha em
 * qualquer uma das leituras não derruba a página: a área só deixa de aparecer (só o motivo curto vai ao registro).
 */
export async function readNewsFeed(client: HouseClient): Promise<NewsEntry[]> {
  const [items, windowOpen] = await Promise.all([
    readNews(client).catch((error: unknown) => {
      log.warn("news_feed_failed", { reason: error instanceof Error ? error.message.slice(0, 40) : "unknown" });
      return [] as NewsItem[];
    }),
    readTransferWindow(client).catch(() => false),
  ]);
  return buildNewsFeed({ windowOpen, items });
}

export async function readNews(client: HouseClient): Promise<NewsItem[]> {
  const { data, error } = await client
    .from("news")
    .select("id, title, body, link, published_at")
    .order("published_at", { ascending: false })
    .limit(newsLimit);
  if (error) throw new Error(`news_read_failed:${errorCode(error)}`);
  const parsed = rows.safeParse(data ?? []);
  if (!parsed.success) throw new Error("news_read_failed:shape");
  return parsed.data.map((row) => ({ id: row.id, title: row.title, body: row.body, link: row.link, publishedAt: row.published_at }));
}
