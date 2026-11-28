import { NextResponse, type NextRequest } from "next/server";
import { loadPhoto } from "@/modules/profiles";
import { requireUserClient } from "@/server/auth/session";

// Leitura da foto do perfil (#308): o ÚNICO caminho por onde a miniatura sai do banco. Exige sessão
// (o proxy já manda quem não tem para o login), lê com o JWT de quem pede (R14: a RLS
// `app.can_view_photo` decide) e devolve o WebP decifrado. Quem não pode ver recebe o mesmo 404 de
// "sem foto". Nunca em cache compartilhado nem indexável.
const NO_STORE = {
  "Cache-Control": "private, no-store",
  "X-Robots-Tag": "noindex, nofollow",
  "X-Content-Type-Options": "nosniff",
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, context: Context): Promise<NextResponse> {
  const { id } = await context.params;
  if (!UUID.test(id)) return new NextResponse(null, { status: 404, headers: NO_STORE });
  const { client } = await requireUserClient();
  const webp = await loadPhoto(client, id);
  if (webp === null) return new NextResponse(null, { status: 404, headers: NO_STORE });
  return new NextResponse(new Uint8Array(webp), { status: 200, headers: { ...NO_STORE, "Content-Type": "image/webp" } });
}
