// A casa de membros (#303, ADR 0014 revisão de 28/11): todo membro logado vê a medalha da casa das pessoas ativas. A
// função `member_houses` devolve só o id e a chave da casa aceita e vigente; a chave é validada aqui contra as casas da
// config (as que o app conhece). Sem `service_role`: o cliente é o da sessão (R14). Nada aqui vai para log.
import "server-only";
import { z } from "zod";
import type { HouseClient } from "../types";

/** Teto de pessoas por chamada: o mesmo da função do banco. */
export const memberHousesBatch = 200;

const rows = z.array(z.object({ profile_id: z.string(), house_key: z.string() }));
const errorCode = (error: unknown): string => {
  const code = typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;
  return typeof code === "string" && /^[A-Za-z0-9]{1,8}$/.test(code) ? code : "failed";
};

/**
 * A chave da casa de cada pessoa pedida que o banco liberou (ativa, com casa aceita e vigente) e que é uma casa conhecida
 * da config. Quem não aparece no mapa fica sem casa. Erro do banco ou formato inesperado lança só o código (a tela
 * mostra sem a casa, nunca quebra).
 */
export async function readMemberHouses(client: HouseClient, ids: readonly string[], knownHouseKeys: readonly string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const unique = [...new Set(ids)];
  if (unique.length === 0) return out;
  const known = new Set(knownHouseKeys);
  for (let start = 0; start < unique.length; start += memberHousesBatch) {
    const batch = unique.slice(start, start + memberHousesBatch);
    const { data, error } = await client.rpc("member_houses", { p_profiles: batch });
    if (error) throw new Error(`member_houses_failed:${errorCode(error)}`);
    const parsed = rows.safeParse(data ?? []);
    if (!parsed.success) throw new Error("member_houses_failed:shape");
    const asked = new Set(batch);
    for (const row of parsed.data) {
      if (asked.has(row.profile_id) && known.has(row.house_key)) out.set(row.profile_id, row.house_key);
    }
  }
  return out;
}
