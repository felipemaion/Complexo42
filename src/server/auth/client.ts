import { createServerClient } from "@supabase/ssr";

// Cliente do Supabase Auth do lado do servidor (#9). Não existe cliente no navegador: o
// navegador só segue redirecionamentos para /auth/v1 (ADR 0009 §1) e guarda o cookie.

/**
 * Nome fixo do cookie de sessão. Sem ele, o @supabase/ssr deriva o nome do host da URL, e a URL
 * interna (kong) e a pública dariam nomes diferentes, perdendo o verificador PKCE.
 */
export const AUTH_COOKIE_NAME = "sb-app-auth-token";

export type CookieToSet = { name: string; value: string; options?: Record<string, unknown> };
export type CookieAdapter = {
  getAll(): { name: string; value: string }[];
  /** `headers`: cabeçalhos anti-cache que o @supabase/ssr pede para a resposta que grava cookie. */
  setAll(cookies: CookieToSet[], headers: Record<string, string>): void;
};

export type AuthClientOptions = {
  url: string;
  anonKey: string;
  cookies: CookieAdapter;
  /** Cookie só por HTTPS (produção e staging). */
  secure: boolean;
  /** Cabeçalhos extras para o GoTrue (ex.: IP do cliente, para o rate limit por IP). */
  headers?: Record<string, string>;
};

export function createAuthClient({ url, anonKey, cookies, secure, headers }: AuthClientOptions) {
  return createServerClient(url, anonKey, {
    // httpOnly: nenhum script do navegador lê a sessão (não há cliente Supabase no navegador).
    cookieOptions: { name: AUTH_COOKIE_NAME, httpOnly: true, secure, sameSite: "lax", path: "/" },
    cookies,
    ...(headers ? { global: { headers } } : {}),
  });
}

export type AuthClient = ReturnType<typeof createAuthClient>;

/**
 * Cookies de sessão para EXPIRAR no navegador (sessão vencida): o cookie inteiro ou em pedaços (`.0`, `.1`...).
 * O verificador do login em andamento (`-code-verifier`) e os cookies de fora ficam em paz.
 */
export function expiredAuthCookies(names: Iterable<string>, secure: boolean): CookieToSet[] {
  const sessionCookie = new RegExp(`^${AUTH_COOKIE_NAME}(\\.\\d+)?$`);
  const out: CookieToSet[] = [];
  for (const name of names) {
    if (sessionCookie.test(name)) out.push({ name, value: "", options: { maxAge: 0, path: "/", httpOnly: true, secure, sameSite: "lax" } });
  }
  return out;
}

export function hasAuthCookie(names: Iterable<string>): boolean {
  for (const name of names) if (name.startsWith(AUTH_COOKIE_NAME)) return true;
  return false;
}
