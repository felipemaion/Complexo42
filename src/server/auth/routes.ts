// Rotas do login e regra de acesso por rota (#9). Puro: sem Next, sem rede.

export const LOGIN_PATH = "/entrar";
export const HOME_PATH = "/inicio";
export const CALLBACK_PATH = "/auth/callback";
/** Página intermediária do link mágico: o GET só mostra o botão; o login é um POST. */
export const CONFIRM_PATH = "/auth/confirmar";
/** Encerra a sessão quando o acesso foi bloqueado ou a checagem falhou. */
export const SIGNOUT_PATH = "/auth/sair";
/** Tela de quem está na lista de espera (ADR 0008 §1, página da #26). */
export const WAITLIST_PATH = "/espera";

// Tudo o que não está aqui exige sessão (negado por padrão). /espera é só texto fixo, sem dado
// de ninguém (#26), e precisa abrir mesmo sem sessão válida. `/api/healthz` nem passa pelo
// proxy (veja o matcher em src/proxy.ts).
const PUBLIC_PATHS: ReadonlySet<string> = new Set(["/", LOGIN_PATH, CALLBACK_PATH, CONFIRM_PATH, SIGNOUT_PATH, WAITLIST_PATH]);

export function isPublicPath(path: string): boolean {
  return PUBLIC_PATHS.has(path.length > 1 ? path.replace(/\/+$/, "") : path);
}

/**
 * Destino depois do login, vindo do parâmetro `next`. Só caminho interno: o pathname já
 * NORMALIZADO (sem `.`/`..`) precisa começar com uma barra só. Sem isso, `/.//mal.example`
 * viraria `//mal.example`, que o navegador lê como outro site. Idempotente: aplicar de novo
 * devolve o mesmo valor.
 */
export function safeNextPath(raw: unknown): string {
  if (typeof raw !== "string" || !raw.startsWith("/") || raw.length > 512) return HOME_PATH;
  // Barra invertida (navegadores tratam como `/`) e caracteres de controle, crus ou codificados.
  if (/[\\\u0000-\u001f\u007f]|%5c|%0[0-9a-f]|%1[0-9a-f]|%7f/i.test(raw)) return HOME_PATH;
  const base = "http://origem.invalid";
  let url: URL;
  try {
    url = new URL(raw, base);
  } catch {
    return HOME_PATH;
  }
  const path = url.pathname;
  if (url.origin !== base || !/^\/(?!\/)/.test(path) || path.includes("\\")) return HOME_PATH;
  if (path === LOGIN_PATH || path.startsWith("/auth/")) return HOME_PATH;
  return path + url.search;
}

export type RouteDecision = { action: "next" } | { action: "redirect"; to: string };

/** Decide, no proxy, se a requisição segue ou é redirecionada. */
export function decideRoute(path: string, search: string, authenticated: boolean): RouteDecision {
  if (!authenticated && !isPublicPath(path)) {
    return { action: "redirect", to: `${LOGIN_PATH}?next=${encodeURIComponent(path + search)}` };
  }
  if (authenticated && path === LOGIN_PATH) return { action: "redirect", to: HOME_PATH };
  return { action: "next" };
}

/** Respostas de login e as que gravam cookie não podem ficar em cache compartilhado (L3). */
export function needsNoStore(path: string, setsCookie: boolean): boolean {
  return setsCookie || path === LOGIN_PATH || path.startsWith("/auth/");
}
