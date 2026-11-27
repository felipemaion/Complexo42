import { NextResponse, type NextRequest } from "next/server";
import { createAuthClient, expiredAuthCookies, hasAuthCookie, type CookieToSet } from "@/server/auth/client";
import { getAuthConfig } from "@/server/auth/config";
import { isExpiredSession } from "@/server/auth/errors";
import { decideRoute, isPublicPath, LOGIN_PATH, needsNoStore } from "@/server/auth/routes";
import { buildCsp, CSP_HEADER, CSP_REPORT_ONLY_HEADER, cspHeaderName, newNonce, NONCE_HEADER } from "@/server/csp";

// Proxy (antigo middleware, Next 16) do login (#9): renova a sessão no cookie e manda quem não
// entrou para /entrar. É a checagem otimista; cada página protegida confere de novo
// (requireUser, com o access_status) e o banco confere pela RLS. Também põe a CSP com nonce (#152).
export async function proxy(request: NextRequest): Promise<NextResponse> {
  const config = getAuthConfig();
  const pending: CookieToSet[] = [];
  const extraHeaders: Record<string, string> = {};
  let authenticated = false;
  let sessionExpired = false;

  // Sem cookie de sessão, nem chama o GoTrue.
  if (config && hasAuthCookie(request.cookies.getAll().map((c) => c.name))) {
    const supabase = createAuthClient({
      url: config.internalUrl,
      anonKey: config.anonKey,
      secure: config.siteUrl.startsWith("https:"),
      cookies: {
        getAll: () => request.cookies.getAll(),
        // O @supabase/ssr manda junto cabeçalhos anti-cache para a resposta que grava cookie.
        setAll: (list, headers) => {
          for (const { name, value } of list) request.cookies.set(name, value);
          pending.push(...list);
          Object.assign(extraHeaders, headers);
        },
      },
    });
    const { data, error } = await supabase.auth.getUser();
    authenticated = Boolean(data.user);
    if (!authenticated && isExpiredSession(error)) {
      // Sessão vencida (timebox de 30 dias): expira os cookies de sessão em vez de deixá-los apodrecer.
      sessionExpired = true;
      pending.length = 0;
      pending.push(...expiredAuthCookies(request.cookies.getAll().map((c) => c.name), config.siteUrl.startsWith("https:")));
    }
  }

  const path = request.nextUrl.pathname;
  let decision = decideRoute(path, request.nextUrl.search, authenticated);
  // Quem tinha sessão e ela venceu: em página protegida, /entrar com o aviso (e o caminho, para voltar) em vez
  // de um /entrar mudo. Em /entrar e nas outras públicas só segue, já sem os cookies (nada de laço).
  if (sessionExpired && decision.action === "redirect" && !isPublicPath(path) && path !== LOGIN_PATH) {
    decision = { action: "redirect", to: `${LOGIN_PATH}?erro=session_expired&next=${encodeURIComponent(path)}` };
  }
  // CSP (#152): nonce novo por requisição. Vai no cabeçalho da requisição repassada à página (o Next lê
  // dali o nonce) e no da resposta (o navegador aplica). O redirecionamento também leva, por garantia.
  const nonce = newNonce();
  const cspName = cspHeaderName(process.env.CSP_REPORT_ONLY === "1");
  const csp = buildCsp({
    nonce,
    isDev: process.env.NODE_ENV === "development",
    isHttps: (process.env.SITE_URL ?? "").startsWith("https:"),
  });
  // Cópia feita depois do setAll acima: já leva os cookies renovados da sessão. Sem os cabeçalhos de CSP
  // que o cliente mandou: o Next lê o nonce do primeiro que achar, e leria o forjado.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.delete(CSP_HEADER);
  requestHeaders.delete(CSP_REPORT_ONLY_HEADER);
  requestHeaders.set(NONCE_HEADER, nonce);
  requestHeaders.set(cspName, csp);
  const response =
    decision.action === "redirect"
      ? NextResponse.redirect(new URL(decision.to, request.url))
      : NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set(cspName, csp);
  for (const { name, value, options } of pending) response.cookies.set(name, value, options);
  for (const [name, value] of Object.entries(extraHeaders)) response.headers.set(name, value);
  // L3: login e respostas que gravam cookie nunca em cache compartilhado.
  if (needsNoStore(path, pending.length > 0)) response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export const config = {
  // Fora do proxy: arquivos estáticos, as imagens das casas e o logo do app (`/casas/...`), os ícones do
  // app os templates de e-mail do GoTrue (`/emails/...`, buscados pela rede interna sem sessão) e o healthz (monitorado de fora, sem sessão): a página de entrada mostra o logo e o navegador pede
  // o favicon antes de qualquer login. Ancorado em `/` ou no fim, para `/api/healthz-x`, `/casas-x` ou
  // `/icon.png.x` não escaparem (L1).
  matcher: ["/((?!(?:_next/static|_next/image|favicon\\.ico|icon\\.png|apple-icon\\.png|api/healthz)(?:/|$))(?!casas/)(?!emails/).*)"],
};
