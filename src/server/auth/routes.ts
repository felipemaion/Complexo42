// Rotas do login e regra de acesso por rota (#9). Puro: sem Next, sem rede.

export const LOGIN_PATH = "/entrar";
export const HOME_PATH = "/inicio";
export const CALLBACK_PATH = "/auth/callback";

// Tudo o que não está aqui exige sessão (negado por padrão). `/api/healthz` nem passa pelo
// proxy (veja o matcher em src/proxy.ts).
const PUBLIC_PATHS: ReadonlySet<string> = new Set(["/", LOGIN_PATH, CALLBACK_PATH]);

export function isPublicPath(path: string): boolean {
  return PUBLIC_PATHS.has(path.length > 1 ? path.replace(/\/+$/, "") : path);
}

/**
 * Destino depois do login, vindo do parâmetro `next`. Só caminhos internos: qualquer coisa que
 * escape da origem (`//outro.site`, `/\outro.site`, `https://…`) vira a página inicial logada.
 */
export function safeNextPath(raw: unknown): string {
  if (typeof raw !== "string" || !raw.startsWith("/") || raw.length > 512) return HOME_PATH;
  // Barra invertida e caracteres de controle: navegadores tratam `\` como `/`.
  if (/[\\\u0000-\u001f\u007f]/.test(raw)) return HOME_PATH;
  const base = "http://origem.invalid";
  let url: URL;
  try {
    url = new URL(raw, base);
  } catch {
    return HOME_PATH;
  }
  if (url.origin !== base) return HOME_PATH;
  if (url.pathname === LOGIN_PATH || url.pathname.startsWith(CALLBACK_PATH)) return HOME_PATH;
  return url.pathname + url.search;
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
