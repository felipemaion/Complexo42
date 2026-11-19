"use server";
// Server actions do login (#9). Os formulários de /entrar postam aqui; nada de cliente
// Supabase no navegador. O e-mail digitado nunca volta para a URL nem para a tela.
import { redirect } from "next/navigation";
import { getAuthConfig } from "./config";
import { requestMagicLink, startGoogleSignIn } from "./flows";
import { LOGIN_PATH } from "./routes";
import { clearAuthCookies, requestAuthClient } from "./session";

const loginWith = (query: string) => `${LOGIN_PATH}?${query}`;

export async function signInWithGoogle(formData: FormData): Promise<never> {
  const config = getAuthConfig();
  if (!config) redirect(loginWith("erro=unavailable"));
  // Endereço público: o navegador é mandado para <origem>/auth/v1/authorize.
  const auth = (await requestAuthClient(config, "public")).auth;
  const next = formData.get("next");
  const result = await startGoogleSignIn(auth, { siteUrl: config.siteUrl, ...(typeof next === "string" ? { next } : {}) });
  redirect(result.ok ? result.url : loginWith(`erro=${result.error}`));
}

export async function sendMagicLink(formData: FormData): Promise<never> {
  const config = getAuthConfig();
  if (!config) redirect(loginWith("erro=unavailable"));
  const auth = (await requestAuthClient(config)).auth;
  const result = await requestMagicLink(auth, { email: formData.get("email"), siteUrl: config.siteUrl });
  redirect(loginWith(result.ok ? "enviado=1" : `erro=${result.error}`));
}

export async function signOut(): Promise<never> {
  const config = getAuthConfig();
  if (config) await (await requestAuthClient(config)).auth.signOut({ scope: "local" });
  await clearAuthCookies();
  redirect(loginWith("saiu=1"));
}
