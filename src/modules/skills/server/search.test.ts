import { describe, expect, it, vi } from "vitest";
import type { HouseClient } from "@/modules/houses";
import { searchPeople } from "./search";

type HouseQuery = ReturnType<ReturnType<HouseClient["from"]>["select"]>;
const A = "8f1c2a4e-0b5d-4c3a-9e7f-1a2b3c4d5e6f";
const P1 = "00000000-0000-4000-8000-000000000001";
const P2 = "00000000-0000-4000-8000-000000000002";
const P3 = "00000000-0000-4000-8000-000000000003";

const row = (id: string, common = 1) => ({
  profile_id: id,
  display_name_enc: `v1.enc.${id}`,
  state_code: "SP",
  municipality_code: 3550308,
  team_name: "Turma S",
  common_count: common,
  skill_ids: [A],
});

function fake(rpc: { data?: unknown; error?: unknown }, municipalities: unknown = [{ code: 3550308, name: "São Paulo" }]) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const filters: unknown[][] = [];
  const answer = { data: municipalities, error: null };
  const query: HouseQuery = {
    eq: (...a) => (filters.push(["eq", ...a]), query),
    is: (...a) => (filters.push(["is", ...a]), query),
    not: (...a) => (filters.push(["not", ...a]), query),
    neq: (...a) => (filters.push(["neq", ...a]), query),
    in: (...a) => (filters.push(["in", ...a]), query),
    order: (...a) => (filters.push(["order", ...a]), query),
    limit: (...a) => (filters.push(["limit", ...a]), query),
    maybeSingle: () => Promise.resolve(answer),
    then: (ok, fail) => Promise.resolve(answer).then(ok, fail),
  };
  const client: HouseClient = {
    rpc: (fn, args) => (calls.push({ fn, args }), Promise.resolve({ data: rpc.data ?? null, error: rpc.error ?? null })),
    from: (table) => ({ select: (columns) => (filters.push(["from", table, columns]), query) }),
  };
  return { client, calls, filters };
}

const decrypt = vi.fn(async (value: string) => `Nome de ${value.split(".").pop()}`);

describe("searchPeople", () => {
  it("manda ao banco só os filtros validados (o banco confere o escopo, o limite por hora e audita)", async () => {
    const { client, calls } = fake({ data: [] });
    await searchPeople(client, { skillIds: [A], mode: "any", state: "SP", municipality: 3550308, unit: A, noTeam: true }, decrypt);
    expect(calls).toEqual([
      {
        fn: "search_people_by_skills",
        args: { p_skill_ids: [A], p_mode: "any", p_state: "SP", p_municipality: 3550308, p_district: null, p_unit: A, p_no_team: true, p_limit: 20, p_after_common: null, p_after_id: null },
      },
    ]);
  });

  it("decifra só o nome de quem está na página e devolve o cursor da próxima", async () => {
    decrypt.mockClear();
    const { client } = fake({ data: [row(P1, 2), row(P2, 1), row(P3, 1)] });
    const result = await searchPeople(client, { skillIds: [A], mode: "any", limit: 2 }, decrypt);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.people.map((p) => p.id)).toEqual([P1, P2]);
    expect(result.people[0]).toMatchObject({ name: `Nome de ${P1}`, municipality: "São Paulo", state: "SP", team: "Turma S", commonCount: 2, skillIds: [A] });
    expect(result.next).toEqual({ common: 1, id: P2 });
    expect(decrypt).toHaveBeenCalledTimes(2);
  });

  it("sem sobra, não há próxima página", async () => {
    const { client } = fake({ data: [row(P1)] });
    const result = await searchPeople(client, { skillIds: [A], mode: "all" }, decrypt);
    expect(result).toMatchObject({ ok: true, next: null });
  });

  it("nome que não decifra vira nulo, sem derrubar a lista nem repassar o erro", async () => {
    const failing = vi.fn(async () => {
      throw new Error("detalhe interno");
    });
    const { client } = fake({ data: [row(P1)] });
    const result = await searchPeople(client, { skillIds: [A], mode: "all" }, failing);
    expect(result).toMatchObject({ ok: true, people: [{ id: P1, name: null }] });
  });

  it("entrada inválida não chega ao banco: sem habilidade, mais de 5, modo, limite acima de 50, campo a mais", async () => {
    const { client, calls } = fake({ data: [] });
    const ids = Array.from({ length: 6 }, (_, n) => `00000000-0000-4000-8000-00000000000${n}`);
    for (const input of [{ skillIds: [], mode: "all" }, { skillIds: ids, mode: "all" }, { skillIds: [A], mode: "x" }, { skillIds: [A], mode: "all", limit: 51 }, { skillIds: [A], mode: "all", extra: 1 }]) {
      expect(await searchPeople(client, input, decrypt)).toEqual({ ok: false, error: "invalid" });
    }
    expect(calls).toEqual([]);
  });

  it("traduz as recusas do banco, sem repassar a mensagem", async () => {
    const code = async (c: string) => searchPeople(fake({ error: { code: c, message: "detalhe interno" } }).client, { skillIds: [A], mode: "all" }, decrypt);
    expect(await code("54000")).toEqual({ ok: false, error: "rate_limited" });
    expect(await code("42501")).toEqual({ ok: false, error: "forbidden" });
    expect(await code("22023")).toEqual({ ok: false, error: "invalid" });
    expect(await code("XX000")).toEqual({ ok: false, error: "failed" });
  });
});
