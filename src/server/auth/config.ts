import type { ServerEnv } from "@/server/env";
import { getEnv } from "@/server/env";

// Configuração do login a partir do ambiente (#9, ADR 0009 §1).
export type AuthConfig = {
  /** Onde o servidor fala com o Supabase (rede interna em produção, ex.: http://kong:8000). */
  internalUrl: string;
  /** Origem pública cujo /auth/v1 o navegador alcança (redirecionamento do Google). */
  publicUrl: string;
  /** Chave pública (anon). Nunca a service_role (R6, validado em env.ts). */
  anonKey: string;
  /** Origem pública do app (endereço de retorno do login). */
  siteUrl: string;
  /** Repassa o CF-Connecting-IP ao GoTrue (só atrás da Cloudflare; ver env.ts). */
  trustCfConnectingIp: boolean;
};

const DEV_SITE_URL = "http://127.0.0.1:3000";

/** Null quando o login não está configurado (só possível fora de produção). */
export function authConfigFrom(env: ServerEnv): AuthConfig | null {
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) return null;
  const strip = (url: string) => url.replace(/\/+$/, "");
  return {
    internalUrl: strip(env.SUPABASE_URL),
    publicUrl: strip(env.SUPABASE_PUBLIC_URL ?? env.SUPABASE_URL),
    anonKey: env.SUPABASE_ANON_KEY,
    siteUrl: strip(env.SITE_URL ?? DEV_SITE_URL),
    trustCfConnectingIp: env.TRUST_CF_CONNECTING_IP,
  };
}

export function getAuthConfig(): AuthConfig | null {
  return authConfigFrom(getEnv());
}
