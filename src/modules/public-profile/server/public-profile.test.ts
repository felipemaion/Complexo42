import { describe, expect, it } from "vitest";
import type { HouseClient } from "@/modules/houses";
import { readOwnBadgePrefs, readPublicProfile, saveBadgePrefs } from "./public-profile";

type HouseQuery = ReturnType<ReturnType<HouseClient["from"]>["select"]>;
const ID = "00000000-0000-4000-8000-000000000001";
const decrypt = async (value: string) => `dec:${value}`;

function fake(opts: { rpc?: { data?: unknown; error?: unknown }; table?: { data?: unknown; error?: unknown } }) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const tables: string[] = [];
  const answer = { data: opts.table?.data ?? null, error: opts.table?.error ?? null };
  const query: HouseQuery = {
    eq: () => query,
    is: () => query,
    not: () => query,
    neq: () => query,
    in: () => query,
    order: () => query,
    limit: () => query,
    maybeSingle: () => Promise.resolve(answer),
    then: (ok, fail) => Promise.resolve(answer).then(ok, fail),
  };
  const client: HouseClient = {
    rpc: (fn, args) => (calls.push({ fn, args }), Promise.resolve({ data: opts.rpc?.data ?? null, error: opts.rpc?.error ?? null })),
    from: (table) => ({ select: () => (tables.push(table), query) }),
  };
  return { client, calls, tables };
}

const found = { profile_id: ID, display_name_enc: "v1.enc", badges: ["totem", "casa-velha", "house"] };

describe("readPublicProfile", () => {
  it("devolve nome decifrado e só medalhas conhecidas, na ordem", async () => {
    const { client, tables } = fake({ rpc: { data: [found] } });
    expect(await readPublicProfile(client, ID, decrypt, { withPhoto: false })).toEqual({ id: ID, name: "dec:v1.enc", hasPhoto: false, badges: ["totem", "house"] });
    expect(tables).toEqual([]);
  });

  it("com a foto ligada, consulta se a pessoa tem", async () => {
    const { client, tables } = fake({ rpc: { data: [found] }, table: { data: { profile_id: ID } } });
    expect((await readPublicProfile(client, ID, decrypt, { withPhoto: true }))?.hasPhoto).toBe(true);
    expect(tables).toEqual(["profile_photos"]);
  });

  it("zero linhas, erro e id inválido dão o mesmo null", async () => {
    expect(await readPublicProfile(fake({ rpc: { data: [] } }).client, ID, decrypt, { withPhoto: false })).toBeNull();
    expect(await readPublicProfile(fake({ rpc: { error: { code: "42501" } } }).client, ID, decrypt, { withPhoto: false })).toBeNull();
    const spy = fake({ rpc: { data: [found] } });
    expect(await readPublicProfile(spy.client, "nao-e-uuid", decrypt, { withPhoto: false })).toBeNull();
    expect(spy.calls).toEqual([]);
  });

  it("nome que não decifra vira null, sem derrubar a página", async () => {
    const { client } = fake({ rpc: { data: [found] } });
    const broken = async () => {
      throw new Error("x");
    };
    expect((await readPublicProfile(client, ID, broken, { withPhoto: false }))?.name).toBeNull();
  });
});

describe("readOwnBadgePrefs", () => {
  it("sem linhas vale o padrão", async () => {
    expect(await readOwnBadgePrefs(fake({ table: { data: [] } }).client, ID)).toEqual([
      { kind: "house", shown: true },
      { kind: "totem", shown: true },
    ]);
  });

  it("mantém a ordem e o que está escondido", async () => {
    const { client } = fake({ table: { data: [{ badge_kind: "totem", shown: false }, { badge_kind: "house", shown: true }] } });
    expect(await readOwnBadgePrefs(client, ID)).toEqual([
      { kind: "totem", shown: false },
      { kind: "house", shown: true },
    ]);
  });
});

describe("saveBadgePrefs", () => {
  it("manda tipos e visibilidade na mesma ordem", async () => {
    const { client, calls } = fake({});
    expect(await saveBadgePrefs(client, [{ kind: "totem", shown: false }, { kind: "house", shown: true }])).toEqual({ ok: true });
    expect(calls).toEqual([{ fn: "set_my_badge_prefs", args: { p_kinds: ["totem", "house"], p_shown: [false, true] } }]);
  });

  it.each([
    ["22023", "invalid"],
    ["42501", "forbidden"],
    ["XX000", "failed"],
  ])("erro %s vira %s", async (code, expected) => {
    expect(await saveBadgePrefs(fake({ rpc: { error: { code } } }).client, [{ kind: "house", shown: true }])).toEqual({ ok: false, error: expected });
  });
});
