import { describe, expect, it } from "vitest";
import type { HouseClient, HouseQuery } from "../types";
import { archiveNews, publishNews, readManagedNews, readNewsUnits } from "./news-admin";

const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";
const U3 = "33333333-3333-4333-8333-333333333333";
const ME = "99999999-9999-4999-8999-999999999999";
const input = { unitId: U1, title: "Encontro", body: "Sábado, 10h.", link: null, expiresAt: null };

type Reply = { data?: unknown; error?: unknown };
function fake(tables: Record<string, Reply> = {}, rpc: Reply = {}) {
  const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];
  const reads: { table: string; columns: string; filters: unknown[][] }[] = [];
  const client: HouseClient = {
    rpc: async (fn, args) => (rpcCalls.push({ fn, args }), { data: rpc.data ?? null, error: rpc.error ?? null }),
    from: (table) => ({
      select: (columns) => {
        const filters: unknown[][] = [];
        reads.push({ table, columns, filters });
        const reply = { data: tables[table]?.data ?? null, error: tables[table]?.error ?? null };
        const query: HouseQuery = {
          eq: (...a) => (filters.push(["eq", ...a]), query),
          is: (...a) => (filters.push(["is", ...a]), query),
          not: (...a) => (filters.push(["not", ...a]), query),
          neq: (...a) => (filters.push(["neq", ...a]), query),
          in: (...a) => (filters.push(["in", ...a]), query),
          order: (...a) => (filters.push(["order", ...a]), query),
          limit: (...a) => (filters.push(["limit", ...a]), query),
          maybeSingle: async () => reply,
          // oxlint-disable-next-line unicorn/no-thenable
          then: (resolve, reject) => Promise.resolve(reply).then(resolve, reject),
        };
        return query;
      },
    }),
  };
  return { client, rpcCalls, reads };
}

describe("publishNews", () => {
  it("chama publish_news com os parâmetros certos e devolve o id", async () => {
    const f = fake({}, { data: U2 });
    expect(await publishNews(f.client, { ...input, link: "https://exemplo.org/a", expiresAt: "2026-12-05T23:59:59-03:00" })).toEqual({ ok: true, id: U2 });
    expect(f.rpcCalls).toEqual([
      { fn: "publish_news", args: { p_unit: U1, p_title: "Encontro", p_body: "Sábado, 10h.", p_link: "https://exemplo.org/a", p_expires_at: "2026-12-05T23:59:59-03:00" } },
    ]);
  });

  it("entrada inválida nem chega ao banco", async () => {
    const f = fake();
    expect(await publishNews(f.client, { ...input, unitId: "x" })).toEqual({ ok: false, error: "invalid" });
    expect(f.rpcCalls).toEqual([]);
  });

  it.each([
    ["42501", "forbidden"],
    ["22023", "invalid"],
    ["XX000", "failed"],
  ])("erro %s do banco vira %s", async (code, error) => {
    const f = fake({}, { error: { code, message: "segredo do banco" } });
    expect(await publishNews(f.client, input)).toEqual({ ok: false, error });
  });
});

describe("archiveNews", () => {
  it("chama archive_news", async () => {
    const f = fake();
    expect(await archiveNews(f.client, { id: U1 })).toEqual({ ok: true });
    expect(f.rpcCalls).toEqual([{ fn: "archive_news", args: { p_id: U1 } }]);
  });
  it("id inválido não chega ao banco; 42501 vira forbidden", async () => {
    const f = fake({}, { error: { code: "42501" } });
    expect(await archiveNews(f.client, { id: "x" })).toEqual({ ok: false, error: "invalid" });
    expect(f.rpcCalls).toEqual([]);
    expect(await archiveNews(f.client, { id: U1 })).toEqual({ ok: false, error: "forbidden" });
  });
});

describe("readNewsUnits (as unidades onde a pessoa pode publicar)", () => {
  const roles = { data: [{ unit: { id: U1, path: "br.sp" } }] };
  const units = {
    data: [
      { id: U3, name: "Brasil", path: "br" },
      { id: U1, name: "São Paulo", path: "br.sp" },
      { id: U2, name: "Campinas", path: "br.sp.campinas" },
      { id: "44444444-4444-4444-8444-444444444444", name: "Rio", path: "br.rj" },
      { id: "55555555-5555-4555-8555-555555555555", name: "Outra", path: "br.spx" },
    ],
  };

  it("fica com a unidade do papel e as de baixo, sem as de cima nem as irmãs", async () => {
    const f = fake({ role_assignments: roles, units });
    expect(await readNewsUnits(f.client, ME)).toEqual([
      { id: U1, name: "São Paulo" },
      { id: U2, name: "Campinas" },
    ]);
    expect(f.reads[0]?.filters).toEqual(expect.arrayContaining([["eq", "profile_id", ME], ["eq", "role", "manager"], ["is", "revoked_at", null]]));
  });

  it("sem papel de gestor, lista vazia (e nem lê as unidades)", async () => {
    const f = fake({ role_assignments: { data: [] }, units });
    expect(await readNewsUnits(f.client, ME)).toEqual([]);
    expect(f.reads.map((r) => r.table)).toEqual(["role_assignments"]);
  });

  it("falha na leitura: lista vazia (falha fechada)", async () => {
    expect(await readNewsUnits(fake({ role_assignments: { error: { code: "XX" } } }).client, ME)).toEqual([]);
    expect(await readNewsUnits(fake({ role_assignments: roles, units: { error: { code: "XX" } } }).client, ME)).toEqual([]);
  });
});

describe("readManagedNews", () => {
  it("lê as novidades visíveis, as mais novas primeiro, com o nome da unidade", async () => {
    const f = fake({
      news: { data: [{ id: U1, unit_id: U2, title: "T", published_at: "2026-11-28T10:00:00Z", expires_at: null }] },
    });
    expect(await readManagedNews(f.client)).toEqual([{ id: U1, unitId: U2, title: "T", publishedAt: "2026-11-28T10:00:00Z", expiresAt: null }]);
    expect(f.reads[0]?.filters).toEqual(expect.arrayContaining([["order", "published_at", { ascending: false }], ["limit", 50]]));
  });
  it("erro de leitura: lista vazia", async () => {
    expect(await readManagedNews(fake({ news: { error: { code: "XX" } } }).client)).toEqual([]);
  });
});
