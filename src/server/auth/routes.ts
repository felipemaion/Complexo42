// Rotas do login e regra de acesso por rota (#9). Puro: sem Next, sem rede.

export const LOGIN_PATH = "/entrar";
export const HOME_PATH = "/inicio";
/** Formulário do perfil (#12): quem ainda não tem perfil vai para cá a partir da página inicial. */
export const PROFILE_PATH = "/perfil";
export const CALLBACK_PATH = "/auth/callback";
/** Página intermediária do link mágico: o GET só mostra o botão; o login é um POST. */
export const CONFIRM_PATH = "/auth/confirmar";
/** Encerra a sessão quando o acesso foi bloqueado ou a checagem falhou. */
export const SIGNOUT_PATH = "/auth/sair";
/** Tela de quem está na lista de espera (ADR 0008 §1, página da #26). */
export const WAITLIST_PATH = "/espera";
/** Despedida depois de excluir a conta (#18): a sessão já acabou quando ela abre. */
export const ACCOUNT_DELETED_PATH = "/conta-excluida";

// Tudo o que não está aqui exige sessão (negado por padrão). /espera é só texto fixo, sem dado
// de ninguém (#26), e precisa abrir mesmo sem sessão válida. /conta-excluida também é só texto
// fixo (#18). `/api/healthz` nem passa pelo
// proxy (veja o matcher em src/proxy.ts).
const PUBLIC_PATHS: ReadonlySet<string> = new Set(["/", LOGIN_PATH, CALLBACK_PATH, CONFIRM_PATH, SIGNOUT_PATH, WAITLIST_PATH, ACCOUNT_DELETED_PATH]);

/**
 * Caminhos de link de e-mail de versões antigas (e do Supabase Auth direto): carregam token de uso único na
 * query. Nunca viram `next` nem são repassados: respondem com um redirect para /entrar sem query e o aviso
 * "link antigo, peça outro" (`erro=legacy_link`).
 */
const LEGACY_AUTH_PATHS: ReadonlySet<string> = new Set(["/verify", "/callback", "/auth/v1/verify", "/auth/verify", "/auth/confirm"]);

function stripTrailingSlash(path: string): string {
  return path.length > 1 ? path.replace(/\/+$/, "") : path;
}

export function isLegacyAuthPath(path: string): boolean {
  return LEGACY_AUTH_PATHS.has(stripTrailingSlash(path));
}

/** Lista central de parâmetros de query que carregam credencial (token de uso único, code, sessão). */
const CREDENTIAL_PARAMS: ReadonlySet<string> = new Set([
  "token",
  "token_hash",
  "code",
  "access_token",
  "refresh_token",
  "id_token",
  "provider_token",
  "provider_refresh_token",
]);
/** `type=` dos links de e-mail do Supabase Auth: com eles o `token_hash` é de uso único. */
const CREDENTIAL_TYPES: ReadonlySet<string> = new Set(["magiclink", "recovery", "signup", "invite", "email_change", "email"]);

/** A query (`?a=b&...`) leva alguma credencial? Chaves e valores sem diferenciar maiúsculas. */
export function hasCredentialQuery(search: string): boolean {
  for (const [key, value] of new URLSearchParams(search)) {
    const name = key.toLowerCase();
    if (CREDENTIAL_PARAMS.has(name)) return true;
    if (name === "type" && CREDENTIAL_TYPES.has(value.toLowerCase())) return true;
  }
  return false;
}

export function isPublicPath(path: string): boolean {
  return PUBLIC_PATHS.has(stripTrailingSlash(path));
}

/**
 * Destino depois do login, vindo do parâmetro `next`. Só caminho interno, SEM query nem fragmento (a query
 * pode carregar token de uso único; nada dela vira destino): o pathname já
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
  return path;
}

export type RouteDecision = { action: "next" } | { action: "redirect"; to: string };

/** Decide, no proxy, se a requisição segue ou é redirecionada. */
export function decideRoute(path: string, search: string, authenticated: boolean): RouteDecision {
  const legacyLink = `${LOGIN_PATH}?erro=legacy_link`;
  // Link antigo ou /entrar com credencial na URL: nunca ecoa a query (log de acesso, histórico, Location).
  if (isLegacyAuthPath(path) || (stripTrailingSlash(path) === LOGIN_PATH && hasCredentialQuery(search))) {
    return { action: "redirect", to: legacyLink };
  }
  if (!authenticated && !isPublicPath(path)) {
    // Só o caminho: a query de quem não entrou pode ter token de uso único e nunca vai para o /entrar.
    return { action: "redirect", to: `${LOGIN_PATH}?next=${encodeURIComponent(path)}` };
  }
  if (authenticated && path === LOGIN_PATH) return { action: "redirect", to: HOME_PATH };
  return { action: "next" };
}

/**
 * O que /espera faz com quem a abre (#195), a partir do que o portão de acesso decidiu
 * (`accessRedirect`: null = pode seguir): já liberado vai para dentro (a página é de quem ESPERA);
 * quem segue esperando fica; bloqueado ou com falha na checagem segue o destino do portão.
 */
export function waitlistPageTarget(accessTarget: string | null): string | null {
  if (accessTarget === null) return HOME_PATH;
  return accessTarget === WAITLIST_PATH ? null : accessTarget;
}

/** Respostas de login e as que gravam cookie não podem ficar em cache compartilhado (L3). */
export function needsNoStore(path: string, setsCookie: boolean): boolean {
  return setsCookie || path === LOGIN_PATH || path.startsWith("/auth/") || isLegacyAuthPath(path);
}
