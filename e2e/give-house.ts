import { expect } from "@playwright/test";

/**
 * Casa antes de tudo (ADR 0017): quem usa o perfil, a página inicial ou a coordenação precisa da casa aceita. Dá a casa à
 * pessoa criada pela chave de serviço (vínculo aberto e aceito, como se tivesse aceitado na tela). Só em fixture de
 * teste; as telas da casa têm os seus próprios testes.
 */
export async function giveHouse(
  admin: (path: string, init: RequestInit) => Promise<Response>,
  profileId: string,
  houseKey = "esparta",
): Promise<void> {
  const at = new Date().toISOString();
  const res = await admin("/rest/v1/house_members", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ profile_id: profileId, house_key: houseKey, join_method: "self", joined_at: at, accepted_at: at }),
  });
  expect(res.status).toBe(201);
}
