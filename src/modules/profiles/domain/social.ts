/**
 * Links de redes sociais (issue #17, ADR 0003, docs/MODELO_DADOS.md). Regra pura, sem banco nem
 * React: o servidor normaliza o que a pessoa digitou ANTES de cifrar em `social_links_enc`, e a
 * tela normaliza de novo antes de mostrar (o valor guardado pode ser antigo ou ter sido gravado
 * fora deste código). Um link que não passa aqui nunca vira `href`.
 */

/** Maior link guardado (o `href` normalizado), igual a `profileLimits.socialLinkMaxLength`. */
export const socialLinkMaxLength = 256;
/** Maior texto aceito do formulário antes de normalizar (o resto é recusado, nunca cortado). */
export const socialLinkInputMaxLength = 2048;

/** O `rel` de todo link de rede: sem acesso à janela de origem, sem Referer, sem "endosso". */
export const socialLinkRel = "noopener noreferrer nofollow";

/** Link pronto para a tela: `href` seguro e o texto que aparece (sempre texto puro). */
export type SocialLinkView = { href: string; text: string };

/** Começa com um esquema (`https:`, `javascript:`, `data:`...). */
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
/**
 * Caracteres de controle e de formatação (inclui os que invertem a direção do texto e os de
 * largura zero, usados para disfarçar endereços), espaços e o que só serve para fugir de HTML.
 */
const FORBIDDEN = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\s<>"'`\\]/u;
const IPV4 = /^\d+(\.\d+)*$/;

/**
 * Normaliza um link digitado: só `https://`, sem usuário/senha, sem porta, com domínio de verdade
 * (nada de IP nem `localhost`), até 256 caracteres. Sem esquema (`instagram.com/fulano`), assume
 * `https://`. Domínio com letras de outros alfabetos vira a forma `xn--` (punycode): é ela que
 * aparece na tela, para um `іnstagram.com` com "і" cirílico não se passar pelo verdadeiro.
 * Devolve o `href` normalizado, ou `null` se o link não é aceito.
 */
export function normalizeSocialLink(raw: string): string | null {
  if (raw.length > socialLinkInputMaxLength) return null;
  const typed = raw.normalize("NFC").trim();
  if (typed === "" || FORBIDDEN.test(typed)) return null;
  let url: URL;
  try {
    url = new URL(SCHEME.test(typed) ? typed : `https://${typed}`);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (url.username !== "" || url.password !== "" || url.port !== "") return null;
  const host = url.hostname;
  if (!host.includes(".") || host.endsWith(".") || host.startsWith(".") || host.startsWith("[") || IPV4.test(host)) {
    return null;
  }
  const href = url.href;
  return href.length <= socialLinkMaxLength ? href : null;
}

/**
 * O que a tela mostra de um link guardado: domínio (sem `www.`) e caminho, como texto puro.
 * Link que não passa em `normalizeSocialLink` volta `null` e não é mostrado.
 */
export function socialLinkView(stored: string): SocialLinkView | null {
  const href = normalizeSocialLink(stored);
  if (href === null) return null;
  const url = new URL(href);
  const host = url.hostname.replace(/^www\./, "");
  const path = url.pathname === "/" ? "" : url.pathname.replace(/\/$/, "");
  return { href, text: `${host}${path}` };
}

/** Os links que podem aparecer, na ordem guardada, sem repetidos. */
export function socialLinkViews(stored: readonly string[]): SocialLinkView[] {
  const seen = new Set<string>();
  const views: SocialLinkView[] = [];
  for (const link of stored) {
    const view = socialLinkView(link);
    if (view && !seen.has(view.href)) {
      seen.add(view.href);
      views.push(view);
    }
  }
  return views;
}
