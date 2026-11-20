// Entrada da DEMONSTRAÇÃO: entra direto como uma pessoa fictícia (membro ou coordenação), sem
// e-mail. Só existe com DEMO_MODE=1 no servidor; em qualquer outro caso responde 404. A chave de
// acesso total (DEMO_SERVICE_KEY) fica só no servidor e só gera o link das contas de demonstração
// configuradas (R6: nunca vai ao navegador). Nunca ligar em produção com dados reais.
import { NextResponse, type NextRequest } from "next/server";
import { getAuthConfig } from "@/server/auth/config";
import { confirmMagicLink } from "@/server/auth/flows";
import { clearAuthCookies, requestAuthClient } from "@/server/auth/session";
import { log } from "@/server/log";

const demoAccounts = {
  membro: "DEMO_MEMBER_EMAIL",
  coordenacao: "DEMO_COORDINATOR_EMAIL",
} as const;

type Role = keyof typeof demoAccounts;
const isRole = (value: string | null): value is Role => value === "membro" || value === "coordenacao";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const role = request.nextUrl.searchParams.get("papel");
  const serviceKey = process.env.DEMO_SERVICE_KEY;
  const config = getAuthConfig();
  if (process.env.DEMO_MODE !== "1" || !serviceKey || !config || !isRole(role)) {
    return new NextResponse(null, { status: 404 });
  }
  const email = process.env[demoAccounts[role]];
  if (!email) return new NextResponse(null, { status: 404 });

  const response = await fetch(`${config.internalUrl}/auth/v1/admin/generate_link`, {
    method: "POST",
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ type: "magiclink", email }),
  });
  const link: unknown = await response.json().catch(() => null);
  const tokenHash = typeof link === "object" && link !== null ? (link as { hashed_token?: unknown }).hashed_token : undefined;
  if (!response.ok || typeof tokenHash !== "string") {
    log.warn("demo_entry_failed", { reason: response.status });
    return NextResponse.redirect(new URL("/", config.siteUrl));
  }

  // Troca de visão: apaga a sessão anterior antes de entrar na outra conta fictícia.
  await clearAuthCookies();
  const client = await requestAuthClient(config);
  const result = await confirmMagicLink(client.auth, { token_hash: tokenHash, type: "magiclink" });
  if (!result.ok) {
    log.warn("demo_entry_failed", { reason: result.error });
    return NextResponse.redirect(new URL("/", config.siteUrl));
  }
  return NextResponse.redirect(new URL("/inicio", config.siteUrl));
}
