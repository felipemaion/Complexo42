import "server-only";
import { z } from "zod";

// Mapa de onde estão as pessoas (#24, RF08): contagens por município e por distrito da capital,
// só no escopo de quem coordena (o banco decide). people nulo = menos de 5 ("< 5").

export type AreaClient = {
  readonly rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{ readonly data: unknown; readonly error: unknown }>;
};
export type AreaCount = { readonly label: string; readonly people: number | null };
export type Areas = { readonly cities: ReadonlyMap<number, AreaCount>; readonly districts: readonly AreaCount[] };

export async function readAreas(client: AreaClient): Promise<Areas> {
  const { data, error } = await client.rpc("members_by_area", {});
  if (error) throw new Error("areas_read_failed");
  const rows = z
    .array(z.object({ kind: z.enum(["municipio", "distrito"]), code: z.number().nullable(), label: z.string(), people: z.number().nullable() }))
    .parse(data);
  const cities = new Map<number, AreaCount>();
  const districts: AreaCount[] = [];
  for (const row of rows) {
    if (row.kind === "municipio" && row.code !== null) cities.set(row.code, { label: row.label, people: row.people });
    if (row.kind === "distrito") districts.push({ label: row.label, people: row.people });
  }
  return { cities, districts };
}

/** Força da cor (0 a 1): área sem ninguém 0; "< 5" fraca; o resto proporcional ao maior número. */
export function intensity(people: number | null | undefined, max: number): number {
  if (people === undefined) return 0;
  if (people === null) return 0.2;
  return 0.2 + 0.8 * (people / Math.max(1, max));
}

/** Cliente com o JWT de quem está logado (o banco decide o escopo). */
export async function sessionAreaClient(): Promise<AreaClient | null> {
  const { getAuthConfig } = await import("@/server/auth/config");
  const { requestAuthClient } = await import("@/server/auth/session");
  const config = getAuthConfig();
  if (!config) return null;
  const client = await requestAuthClient(config);
  return { rpc: (fn, args) => client.rpc(fn, args) };
}
