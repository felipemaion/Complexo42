// Cliente do Supabase da sessão (JWT de quem está logado, R14), visto como `HouseClient`.
import "server-only";
import { getAuthConfig } from "@/server/auth/config";
import { requestAuthClient } from "@/server/auth/session";
import type { HouseClient, HouseQuery } from "../types";

/** null quando o Auth não está configurado (o login já responde "indisponível"). */
export async function sessionHouseClient(): Promise<HouseClient | null> {
  const config = getAuthConfig();
  if (!config) return null;
  const client = await requestAuthClient(config);
  return {
    rpc: (fn, args) => client.rpc(fn, args),
    // O construtor de consultas do supabase-js tem tipos genéricos profundos demais para o tsc
    // comparar com `HouseQuery` (TS2589). Os métodos usados (eq, is, not, maybeSingle) existem
    // com essas assinaturas; houses.test.ts cobre o uso.
    from: (table) => ({ select: (columns) => client.from(table).select(columns) as unknown as HouseQuery }),
  };
}
