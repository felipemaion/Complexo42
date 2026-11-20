// Cliente do Supabase da sessão (JWT de quem está logado, R14), visto como `MissionClient`.
// Mesmo padrão de src/modules/houses/server/session.ts.
import "server-only";
import { getAuthConfig } from "@/server/auth/config";
import { requestAuthClient } from "@/server/auth/session";
import type { MissionClient, MissionQuery } from "../types";

/** null quando o Auth não está configurado (o login já responde "indisponível"). */
export async function sessionMissionClient(): Promise<MissionClient | null> {
  const config = getAuthConfig();
  if (!config) return null;
  const client = await requestAuthClient(config);
  return {
    rpc: (fn, args) => client.rpc(fn, args),
    // O construtor de consultas do supabase-js tem tipos genéricos profundos demais para o tsc
    // comparar com `MissionQuery` (TS2589). Os métodos usados (eq, is, order, maybeSingle)
    // existem com essas assinaturas; missions.test.ts cobre o uso.
    from: (table) => ({ select: (columns) => client.from(table).select(columns) as unknown as MissionQuery }),
  };
}
