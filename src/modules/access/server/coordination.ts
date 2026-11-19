// Leituras de apoio das telas da coordenação (#26). Tudo com o cliente do JWT de quem está
// logado (R14): a RLS decide o que volta.
import "server-only";
import { z } from "zod";
import type { CoordinationClient, CoordinationMenu } from "../types";

const roleRows = z.array(z.object({ unit: z.object({ parent_id: z.string().nullable() }) }));

/**
 * Quais atalhos da coordenação mostrar. **Só conforto (R15):** esconder o atalho não protege
 * nada. Quem decide é o banco: `list_waitlist` só devolve quem está no escopo de quem chama,
 * e `import_allowlist` e `decide_access` recusam (42501) quem não pode.
 *
 * Lê os próprios papéis ativos (a RLS de `role_assignments` mostra os seus): com papel de
 * gestor (`manager`) em alguma unidade, a fila; na raiz, também a lista de autorizados.
 * Falha na leitura esconde os atalhos (falha fechada).
 */
export async function readCoordinationMenu(client: CoordinationClient, userId: string): Promise<CoordinationMenu> {
  const { data, error } = await client
    .from("role_assignments")
    .select("unit:units!inner(parent_id)")
    .eq("profile_id", z.guid().parse(userId))
    .eq("role", "manager")
    .is("revoked_at", null);
  const rows = error ? null : roleRows.safeParse(data);
  if (!rows?.success) return { waitlist: false, allowlist: false };
  return { waitlist: rows.data.length > 0, allowlist: rows.data.some((row) => row.unit.parent_id === null) };
}

const municipalityRows = z.array(z.object({ code: z.number().int(), name: z.string() }));

/** Nome das cidades da página da fila (só os códigos dela). Falha: mapa vazio, só a UF aparece. */
export async function municipalityNames(client: CoordinationClient, codes: readonly number[]): Promise<Map<number, string>> {
  const unique = [...new Set(codes)];
  if (unique.length === 0) return new Map();
  const { data, error } = await client.from("municipalities").select("code, name").in("code", unique);
  const rows = error ? null : municipalityRows.safeParse(data);
  return new Map(rows?.success ? rows.data.map((row) => [row.code, row.name]) : []);
}
