// Link do portfólio (#70, ADR 0007 §5). Regra pura: o link passa pela mesma proteção dos links de
// rede (#17: só https, sem IP, sem disfarce); prévia embutida só do YouTube, pelo domínio
// youtube-nocookie (lista fechada). Qualquer outro link aparece como link comum.
import { normalizeSocialLink } from "@/modules/profiles";

const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com"]);
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

/** O `href` seguro do item, ou null se o link não é aceito. */
export function parsePortfolioLink(raw: string): string | null {
  return normalizeSocialLink(raw);
}

/** Endereço da prévia (youtube-nocookie) para um vídeo do YouTube; null para qualquer outro link. */
export function youtubeEmbedUrl(href: string): string | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  let id: string | null = null;
  if (url.hostname === "youtu.be") id = url.pathname.slice(1);
  else if (YOUTUBE_HOSTS.has(url.hostname)) {
    if (url.pathname === "/watch") id = url.searchParams.get("v");
    else if (url.pathname.startsWith("/shorts/")) id = url.pathname.slice("/shorts/".length);
  }
  return id && VIDEO_ID.test(id) ? `https://www.youtube-nocookie.com/embed/${id}` : null;
}
