import { NextResponse, type NextRequest } from "next/server";
import { createAuthClient, hasAuthCookie, type CookieToSet } from "@/server/auth/client";
import { getAuthConfig } from "@/server/auth/config";
import { decideRoute } from "@/server/auth/routes";

// Proxy (antigo middleware, Next 16) do login (#9): renova a sessão no cookie e manda quem não
// entrou para /entrar. É a checagem otimista; cada página protegida confere de novo
// (requireUser) e o banco confere pela RLS.
export async function proxy(request: NextRequest): Promise<NextResponse> {
  const config = getAuthConfig();
  const pending: CookieToSet[] = [];
  let authenticated = false;

  // Sem cookie de sessão, nem chama o GoTrue.
  if (config && hasAuthCookie(request.cookies.getAll().map((c) => c.name))) {
    const supabase = createAuthClient({
      url: config.internalUrl,
      anonKey: config.anonKey,
      secure: config.siteUrl.startsWith("https:"),
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (list) => {
          for (const { name, value } of list) request.cookies.set(name, value);
          pending.push(...list);
        },
      },
    });
    const { data } = await supabase.auth.getUser();
    authenticated = Boolean(data.user);
  }

  const decision = decideRoute(request.nextUrl.pathname, request.nextUrl.search, authenticated);
  const response =
    decision.action === "redirect" ? NextResponse.redirect(new URL(decision.to, request.url)) : NextResponse.next({ request });
  for (const { name, value, options } of pending) response.cookies.set(name, value, options);
  return response;
}

export const config = {
  // Fora do proxy: arquivos estáticos e o healthz (monitorado de fora, sem sessão).
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/healthz).*)"],
};
