import "server-only";
import { getAuthConfig } from "@/server/auth/config";
import { requestAuthClient } from "@/server/auth/session";
import type { SearchClient, SearchQuery } from "../types";

/** null quando o Auth não está configurado (o login já responde "indisponível"). */
export async function sessionSearchClient(): Promise<SearchClient | null> {
  const config = getAuthConfig();
  if (!config) return null;
  const client = await requestAuthClient(config);
  return {
    rpc: (fn, args) => client.rpc(fn, args),
    from: (table) => ({ select: (columns) => client.from(table).select(columns) as unknown as SearchQuery }),
  };
}
