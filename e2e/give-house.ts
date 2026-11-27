import { expect } from "@playwright/test";

/**
 * Casa antes de tudo (ADR 0017): quem usa o perfil, a página inicial ou a coordenação precisa da casa aceita. Dá a casa
 * à pessoa criada pela chave de serviço, pelo mesmo caminho do produto: entra como ela (JWT) e chama `accept_house`
 * (a chave de serviço não escreve em `house_members`). Só em fixture de teste; as telas da casa têm os seus testes.
 */
export async function giveHouse(
  admin: (path: string, init: RequestInit) => Promise<Response>,
  profileId: string,
  houseKey = "esparta",
): Promise<void> {
  const api = process.env.E2E_LIVE_SUPABASE_URL;
  const anon = process.env.E2E_LIVE_ANON_KEY;
  if (!api || !anon) throw new Error("E2E_LIVE_SUPABASE_URL e E2E_LIVE_ANON_KEY são necessárias para dar a casa");
  const user = (await (await admin(`/auth/v1/admin/users/${profileId}`, {})).json()) as { email: string };
  const link = (await (await admin("/auth/v1/admin/generate_link", { method: "POST", body: JSON.stringify({ type: "magiclink", email: user.email }) })).json()) as {
    hashed_token: string;
    verification_type?: string;
  };
  const session = await fetch(`${api}/auth/v1/verify`, {
    method: "POST",
    headers: { apikey: anon, "Content-Type": "application/json" },
    body: JSON.stringify({ type: link.verification_type ?? "magiclink", token_hash: link.hashed_token }),
  });
  expect(session.status).toBe(200);
  const { access_token: token } = (await session.json()) as { access_token: string };
  const res = await fetch(`${api}/rest/v1/rpc/accept_house`, {
    method: "POST",
    headers: { apikey: anon, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ p_house_key: houseKey, p_join_method: "self", p_term_version: null }),
  });
  expect(res.status, await res.clone().text()).toBe(200);
}
