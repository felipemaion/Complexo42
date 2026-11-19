import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { AUTH_COOKIE_NAME, createAuthClient, hasAuthCookie } from "./client";
import { getAuthConfig, type AuthConfig } from "./config";
import { LOGIN_PATH } from "./routes";

// Sessão nas páginas, server actions e rotas (#9). O cliente usa a chave anon + o JWT do
// usuário que está no cookie: a RLS continua valendo (R14).

/** Cliente de auth da requisição atual. `via: "public"` só para montar o endereço do Google. */
export async function requestAuthClient(config: AuthConfig, via: "internal" | "public" = "internal") {
  const store = await cookies();
  // Rate limit por IP no GoTrue (ADR 0009 §6): sem isto, todo pedido feito pelo servidor
  // pareceria vir do mesmo IP. A Cloudflare sobrescreve este cabeçalho na borda.
  const ip = (await headers()).get("cf-connecting-ip");
  return createAuthClient({
    url: via === "public" ? config.publicUrl : config.internalUrl,
    anonKey: config.anonKey,
    secure: config.siteUrl.startsWith("https:"),
    ...(ip ? { headers: { "CF-Connecting-IP": ip } } : {}),
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) store.set(name, value, options);
        } catch {
          // Server Component não grava cookie; o proxy já renovou a sessão nesta requisição.
        }
      },
    },
  });
}

/** Usuário logado (só o id: o e-mail nunca sai daqui para a tela). */
export async function getCurrentUser(): Promise<{ id: string } | null> {
  // cookies() antes de tudo: torna a página dinâmica (nada de pré-renderizar no build).
  const store = await cookies();
  const config = getAuthConfig();
  if (!config || !hasAuthCookie(store.getAll().map((c) => c.name))) return null;
  // getUser confere o JWT no GoTrue; não confiar só no cookie.
  const { data } = await (await requestAuthClient(config)).auth.getUser();
  return data.user ? { id: data.user.id } : null;
}

/** Para páginas protegidas: o proxy já redireciona, isto é a segunda barreira. */
export async function requireUser(): Promise<{ id: string }> {
  const user = await getCurrentUser();
  if (!user) redirect(LOGIN_PATH);
  return user;
}

/** Apaga os cookies de sessão mesmo se o GoTrue não responder ao logout. */
export async function clearAuthCookies(): Promise<void> {
  const store = await cookies();
  for (const { name } of store.getAll()) if (name.startsWith(AUTH_COOKIE_NAME)) store.delete(name);
}
