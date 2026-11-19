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
  setAll(cookies: CookieToSet[]): void;
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

export function hasAuthCookie(names: Iterable<string>): boolean {
  for (const name of names) if (name.startsWith(AUTH_COOKIE_NAME)) return true;
  return false;
}
