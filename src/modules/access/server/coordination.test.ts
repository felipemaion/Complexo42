// Leituras de apoio da coordenação (#26): atalhos pelos próprios papéis (conforto, R15) e
// nomes das cidades. Falha na leitura esconde os atalhos (falha fechada).
import { describe, expect, it } from "vitest";
import type { CoordinationClient } from "../types";
import { municipalityNames, readCoordinationMenu } from "./coordination";

const ME = "0b6f2d4e-3c1a-4f8e-9d2b-7a5c6e1f0a93";
type Filter = { method: string; args: unknown[] };

function fakeClient(result: { data: unknown; error: unknown }) {
  const seen: { table?: string; columns?: string; filters: Filter[] } = { filters: [] };
  const query = {
    eq: (...args: unknown[]) => (seen.filters.push({ method: "eq", args }), query),
    is: (...args: unknown[]) => (seen.filters.push({ method: "is", args }), query),
    in: (...args: unknown[]) => (seen.filters.push({ method: "in", args }), query),
    then: (resolve: (value: unknown) => unknown) => resolve(result),
  };
  const client = {
    from: (table: string) => {
      seen.table = table;
      return {
        select: (columns: string) => {
          seen.columns = columns;
          return query;
        },
      };
    },
  };
  return { client: client as unknown as CoordinationClient, seen };
}

describe("readCoordinationMenu", () => {
  it("lê só os próprios papéis de gestor ativos", async () => {
    const { client, seen } = fakeClient({ data: [], error: null });
    expect(await readCoordinationMenu(client, ME)).toEqual({ waitlist: false, allowlist: false });
    expect(seen.table).toBe("role_assignments");
    expect(seen.filters).toEqual([
      { method: "eq", args: ["profile_id", ME] },
      { method: "eq", args: ["role", "manager"] },
      { method: "is", args: ["revoked_at", null] },
    ]);
  });

  it("gestor abaixo da raiz: só a fila; gestor da raiz: fila e lista", async () => {
    const below = fakeClient({ data: [{ unit: { parent_id: "a1" } }], error: null }).client;
    expect(await readCoordinationMenu(below, ME)).toEqual({ waitlist: true, allowlist: false });
    const root = fakeClient({ data: [{ unit: { parent_id: "a1" } }, { unit: { parent_id: null } }], error: null }).client;
    expect(await readCoordinationMenu(root, ME)).toEqual({ waitlist: true, allowlist: true });
  });

  it("erro ou resposta fora do formato: nenhum atalho", async () => {
    const failed = fakeClient({ data: null, error: { code: "42501" } }).client;
    expect(await readCoordinationMenu(failed, ME)).toEqual({ waitlist: false, allowlist: false });
    const odd = fakeClient({ data: [{ role: "manager" }], error: null }).client;
    expect(await readCoordinationMenu(odd, ME)).toEqual({ waitlist: false, allowlist: false });
  });

  it("id que não é uuid nem chega ao banco", async () => {
    const { client, seen } = fakeClient({ data: [], error: null });
    await expect(readCoordinationMenu(client, "1 or 1=1")).rejects.toThrow();
    expect(seen.filters).toEqual([]);
  });
});

describe("municipalityNames", () => {
  it("busca só os códigos da página, sem repetir", async () => {
    const { client, seen } = fakeClient({ data: [{ code: 3550308, name: "São Paulo" }], error: null });
    expect(await municipalityNames(client, [3550308, 3550308])).toEqual(new Map([[3550308, "São Paulo"]]));
    expect(seen.filters).toEqual([{ method: "in", args: ["code", [3550308]] }]);
  });

  it("sem códigos não consulta; com erro devolve vazio", async () => {
    const { client, seen } = fakeClient({ data: [], error: null });
    expect(await municipalityNames(client, [])).toEqual(new Map());
    expect(seen.table).toBeUndefined();
    expect(await municipalityNames(fakeClient({ data: null, error: { code: "x" } }).client, [1])).toEqual(new Map());
  });
});
