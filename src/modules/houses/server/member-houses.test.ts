import { describe, expect, it, vi } from "vitest";
import type { HouseClient } from "../types";

vi.mock("server-only", () => ({}));
const { memberHousesBatch, readMemberHouses } = await import("./member-houses");

const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";
const KNOWN = ["casa-x", "casa-y"];

function fake(answer: (args: { p_profiles: string[] }) => { data?: unknown; error?: unknown }) {
  const calls: string[][] = [];
  const client = {
    rpc: async (fn: string, args: { p_profiles: string[] }) => {
      expect(fn).toBe("member_houses");
      calls.push(args.p_profiles);
      const { data = null, error = null } = answer(args);
      return { data, error };
    },
  } as unknown as HouseClient;
  return { client, calls };
}

describe("readMemberHouses", () => {
  it("devolve a chave da casa de quem foi pedido e conhecido", async () => {
    const { client } = fake(() => ({ data: [{ profile_id: A, house_key: "casa-x" }, { profile_id: B, house_key: "casa-y" }] }));
    expect(await readMemberHouses(client, [A, B], KNOWN)).toEqual(
      new Map([
        [A, "casa-x"],
        [B, "casa-y"],
      ]),
    );
  });

  it("ignora casa desconhecida da config e linha que ninguém pediu", async () => {
    const { client } = fake(() => ({ data: [{ profile_id: A, house_key: "casa-fantasma" }, { profile_id: B, house_key: "casa-x" }] }));
    expect((await readMemberHouses(client, [A], KNOWN)).size).toBe(0);
  });

  it("sem ids nem chama o banco; ids repetidos viram um só", async () => {
    const empty = fake(() => ({ data: [] }));
    expect((await readMemberHouses(empty.client, [], KNOWN)).size).toBe(0);
    expect(empty.calls).toEqual([]);
    const dup = fake(() => ({ data: [] }));
    await readMemberHouses(dup.client, [A, A, B], KNOWN);
    expect(dup.calls).toEqual([[A, B]]);
  });

  it("parte em lotes do tamanho do teto do banco", async () => {
    const ids = Array.from({ length: memberHousesBatch + 1 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    const { client, calls } = fake(() => ({ data: [] }));
    await readMemberHouses(client, ids, KNOWN);
    expect(calls.map((c) => c.length)).toEqual([memberHousesBatch, 1]);
  });

  it("erro do banco lança só o código; formato estranho lança shape", async () => {
    await expect(readMemberHouses(fake(() => ({ error: { code: "42501", message: "segredo" } })).client, [A], KNOWN)).rejects.toThrow("member_houses_failed:42501");
    await expect(readMemberHouses(fake(() => ({ data: [{ nope: 1 }] })).client, [A], KNOWN)).rejects.toThrow("member_houses_failed:shape");
  });
});
