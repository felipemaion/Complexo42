import "server-only";
import { getAuthConfig } from "@/server/auth/config";
import { requestAuthClient } from "@/server/auth/session";
import type { PortfolioClient } from "./portfolio";

/** Cliente com o JWT de quem está logado: o banco decide o que a pessoa pode (RLS e funções). */
export async function sessionPortfolioClient(): Promise<PortfolioClient | null> {
  const config = getAuthConfig();
  if (!config) return null;
  const client = await requestAuthClient(config);
  return { rpc: (fn, args) => client.rpc(fn, args) };
}
