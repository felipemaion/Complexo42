import "server-only";
import { getAuthConfig } from "@/server/auth/config";
import { requestAuthClient } from "@/server/auth/session";
import type { CollabClient } from "../types";

export async function sessionCollabClient(): Promise<CollabClient | null> {
  const config = getAuthConfig();
  if (!config) return null;
  const client = await requestAuthClient(config);
  return {
    rpc: (fn, args) => client.rpc(fn, args),
  };
}
