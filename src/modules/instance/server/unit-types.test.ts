import { describe, expect, it } from "vitest";
import { readUnitTypeLabels, type UnitTypesClient } from "./unit-types";

function fakeClient(response: { data?: unknown; error?: unknown }) {
  const selects: string[][] = [];
  const client: UnitTypesClient = {
    from: (table) => ({
      select: (columns) => {
        selects.push([table, columns]);
        return Promise.resolve({ data: response.data ?? null, error: response.error ?? null });
      },
    }),
  };
  return { client, selects };
}

describe("readUnitTypeLabels", () => {
  it("lê key, label e level de unit_types", async () => {
    const { client, selects } = fakeClient({ data: [{ key: "team", label: "Rótulo", level: 1 }] });
    expect(await readUnitTypeLabels(client)).toEqual([{ key: "team", label: "Rótulo", level: 1 }]);
    expect(selects).toEqual([["unit_types", "key, label, level"]]);
  });

  it("erro de consulta → null (não vira lista vazia)", async () => {
    const { client } = fakeClient({ error: { code: "42501" } });
    expect(await readUnitTypeLabels(client)).toBeNull();
  });

  it("resposta fora do formato → null", async () => {
    const { client } = fakeClient({ data: [{ key: "team" }] });
    expect(await readUnitTypeLabels(client)).toBeNull();
  });
});
