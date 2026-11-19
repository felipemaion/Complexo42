// Leitura dos rótulos dos tipos de unidade (#54, ADR 0005 §3). O cliente é o da sessão: a RLS
// de `unit_types` só libera para quem é membro ativo (R14).
import "server-only";
import { parseUnitTypeLabels, type UnitTypeLabels } from "../domain/unit-labels";

/** O pedaço do cliente do Supabase que a leitura usa. */
export type UnitTypesClient = {
  from(table: string): { select(columns: string): PromiseLike<{ data: unknown; error: unknown }> };
};

/** null em erro de consulta ou resposta inesperada: quem chama mostra erro, não lista vazia. */
export async function readUnitTypeLabels(client: UnitTypesClient): Promise<UnitTypeLabels | null> {
  const { data, error } = await client.from("unit_types").select("key, label, level");
  if (error) return null;
  return parseUnitTypeLabels(data);
}
