import { NextResponse, type NextRequest } from "next/server";
import { instance } from "@config/instance";
import { isSameOrigin } from "@/modules/privacy";
import { PHOTO_STATUS_PARAM, removeOwnPhoto, type PhotoStatus } from "@/modules/profiles";
import { getAuthConfig } from "@/server/auth/config";
import { PROFILE_PATH } from "@/server/auth/routes";
import { requireUserClient } from "@/server/auth/session";

// Remover a própria foto (#308). Mesma chave e mesma regra de origem do envio: com a chave desligada
// (o padrão), 404. O banco só deixa apagar a linha da própria pessoa (RLS).
const NO_STORE = { "Cache-Control": "private, no-store" };

function backToProfile(request: NextRequest, status: PhotoStatus): NextResponse {
  const url = new URL(PROFILE_PATH, getAuthConfig()?.siteUrl ?? request.url);
  url.searchParams.set(PHOTO_STATUS_PARAM, status);
  return NextResponse.redirect(url, { status: 303, headers: NO_STORE });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!instance.profile.photoEnabled) return new NextResponse(null, { status: 404, headers: NO_STORE });
  const config = getAuthConfig();
  if (!config || !isSameOrigin(request.headers.get("origin"), config.siteUrl)) {
    return new NextResponse(null, { status: 403, headers: NO_STORE });
  }
  const { user, client } = await requireUserClient();
  return backToProfile(request, (await removeOwnPhoto(client, user.id)) ? "removida" : "erro");
}
