// O que a área de novidades da página inicial mostra (#307): o cartão da janela de transferência, derivado do estado da
// própria janela (sem duplicar estado: some quando ela fecha), e as novidades publicadas, as mais novas primeiro.
// Função pura: o que vem do banco entra tipado; o link passa de novo pela regra antes de virar `href`.

export type NewsItem = { id: string; title: string; body: string; link: string | null; publishedAt: string };
export type NewsEntry = ({ kind: "news" } & NewsItem) | { kind: "house_window" };

/** O teto de novidades publicadas na página inicial. */
export const newsFeedLimit = 5;

// A mesma regra do banco (20261128310000): só https, domínio com ponto e sufixo de letras, sem usuário nem espaço.
const LINK = /^https:\/\/([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}(:[0-9]{1,5})?(\/[^\s<>"]*)?$/i;

/** O link só se for https com domínio válido; qualquer outra coisa vira `null` (a novidade continua, sem o link). */
export function safeNewsLink(link: string | null): string | null {
  return link !== null && link.length <= 300 && LINK.test(link) ? link : null;
}

export function buildNewsFeed({ windowOpen, items }: { windowOpen: boolean; items: readonly NewsItem[] }): NewsEntry[] {
  const published = items.slice(0, newsFeedLimit).map((item): NewsEntry => ({ kind: "news", ...item, link: safeNewsLink(item.link) }));
  return windowOpen ? [{ kind: "house_window" }, ...published] : published;
}
