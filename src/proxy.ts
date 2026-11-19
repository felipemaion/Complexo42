import { NextResponse, type NextRequest } from "next/server";
import { createAuthClient, hasAuthCookie, type CookieToSet } from "@/server/auth/client";
import { getAuthConfig } from "@/server/auth/config";
import { decideRoute, needsNoStore } from "@/server/auth/routes";

// Proxy (antigo middleware, Next 16) do login (#9): renova a sessão no cookie e manda quem não
// entrou para /entrar. É a checagem otimista; cada página protegida confere de novo
// (requireUser, com o access_status) e o banco confere pela RLS.
export async function proxy(request: NextRequest): Promise<NextResponse> {
  const config = getAuthConfig();
  const pending: CookieToSet[] = [];
  const extraHeaders: Record<string, string> = {};
  let authenticated = false;

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
    const { data } = await supabase.auth.getUser();
    authenticated = Boolean(data.user);
  }

  const path = request.nextUrl.pathname;
  const decision = decideRoute(path, request.nextUrl.search, authenticated);
  const response =
    decision.action === "redirect" ? NextResponse.redirect(new URL(decision.to, request.url)) : NextResponse.next({ request });
  for (const { name, value, options } of pending) response.cookies.set(name, value, options);
  for (const [name, value] of Object.entries(extraHeaders)) response.headers.set(name, value);
  // L3: login e respostas que gravam cookie nunca em cache compartilhado.
  if (needsNoStore(path, pending.length > 0)) response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export const config = {
  // Fora do proxy: arquivos estáticos e o healthz (monitorado de fora, sem sessão). Ancorado em
  // `/` ou no fim, para `/api/healthz-x` ou `/favicon.ico.x` não escaparem (L1).
  matcher: ["/((?!(?:_next/static|_next/image|favicon\\.ico|api/healthz)(?:/|$)).*)"],
};
