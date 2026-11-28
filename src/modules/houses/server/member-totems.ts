// O totem de membros (#303, ADR 0014 revisão de 28/11): todo membro logado vê o totem das pessoas ativas. O totem fica
// cifrado no banco (ADR 0003); a função `member_totems` devolve só o valor cifrado e este leitor o DECIFRA aqui, no
// servidor, com o AAD da linha de cada pessoa. O navegador recebe só o código, validado contra a config; o texto cifrado
// nunca vai à tela. Sem `service_role`: o cliente é o da sessão (R14). Nada aqui vai para log além de uma contagem.
import "server-only";
import { z } from "zod";
import type { QuestionnaireConfig } from "@/modules/questionnaire";
import type { CipherContext, HouseClient } from "../types";
import { totemContext } from "./houses";

/** Teto de pessoas por chamada: o mesmo da função do banco. */
export const memberTotemsBatch = 200;

export type MemberTotemsDeps = {
  crypto: { decrypt(value: string, context: CipherContext): Promise<string> };
  questionnaire: Pick<QuestionnaireConfig, "totemLabels">;
  /** Quantas linhas não deram medalha (decifra falhou, código fora da config ou linha que ninguém pediu). Nunca ids. */
  onUnreadable?: (count: number) => void;
};

const rows = z.array(z.object({ profile_id: z.string(), totem_enc: z.string() }));
const errorCode = (error: unknown): string => {
  const code = typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;
  return typeof code === "string" && /^[A-Za-z0-9]{1,8}$/.test(code) ? code : "failed";
};

/**
 * O código do totem de cada pessoa pedida que o banco liberou (ativa, com totem definido). Quem não aparece no mapa fica
 * sem medalha. Erro do banco ou formato inesperado lança só o código (a tela mostra sem medalha, nunca quebra).
 */
export async function readMemberTotems(client: HouseClient, ids: readonly string[], deps: MemberTotemsDeps): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const unique = [...new Set(ids)];
  if (unique.length === 0) return out;
  const codes = new Set(Object.keys(deps.questionnaire.totemLabels));
  let unreadable = 0;
  for (let start = 0; start < unique.length; start += memberTotemsBatch) {
    const batch = unique.slice(start, start + memberTotemsBatch);
    const { data, error } = await client.rpc("member_totems", { p_profiles: batch });
    if (error) throw new Error(`member_totems_failed:${errorCode(error)}`);
    const parsed = rows.safeParse(data ?? []);
    if (!parsed.success) throw new Error("member_totems_failed:shape");
    const asked = new Set(batch);
    for (const row of parsed.data) {
      if (!asked.has(row.profile_id)) {
        unreadable += 1;
        continue;
      }
      try {
        const code = await deps.crypto.decrypt(row.totem_enc, totemContext(row.profile_id));
        if (codes.has(code)) out.set(row.profile_id, code);
        else unreadable += 1;
      } catch {
        unreadable += 1;
      }
    }
  }
  if (unreadable > 0) deps.onUnreadable?.(unreadable);
  return out;
}
