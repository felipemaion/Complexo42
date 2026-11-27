// Portão da casa (ADR 0017): quem não tem vínculo de casa aberto e aceito vai para /casa; erro nega (falha fechada).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { instance } from "@config/instance";

vi.mock("server-only", () => ({}));
type Result = { data: unknown; error: unknown };
let results: Record<string, Result> = {};
const calls: unknown[][] = [];
const client = {
  from: (table: string) => {
    calls.push(["from", table]);
    const query = {
      eq: (...args: unknown[]) => (calls.push(["eq", ...args]), query),
      is: (...args: unknown[]) => (calls.push(["is", ...args]), query),
      not: (...args: unknown[]) => (calls.push(["not", ...args]), query),
      maybeSingle: async () => results[table] ?? { data: null, error: null },
    };
    return { select: () => query };
  },
} as never;

const { houseRedirect } = await import("./house-gate");

beforeEach(() => {
  results = { profiles: { data: { id: "u" }, error: null } };
  calls.length = 0;
});

describe("houseRedirect", () => {
  it("com a casa aceita (vínculo aberto, de uma casa da instância) → segue", async () => {
    results.house_members = { data: { house_key: instance.houses[0]!.id }, error: null };
    expect(await houseRedirect(client, "u")).toBeNull();
    expect(calls).toContainEqual(["from", "house_members"]);
    expect(calls).toContainEqual(["eq", "profile_id", "u"]);
    expect(calls).toContainEqual(["is", "left_at", null]);
    expect(calls).toContainEqual(["not", "accepted_at", "is", null]);
  });

  it("sem casa aceita, mas com perfil (liberado na lista) → vai a /casa", async () => {
    expect(await houseRedirect(client, "u")).toBe("/casa");
  });

  it("vínculo de uma casa que não existe na instância não vale → /casa", async () => {
    results.house_members = { data: { house_key: "casa-inexistente" }, error: null };
    expect(await houseRedirect(client, "u")).toBe("/casa");
  });

  it("sem casa e sem perfil (fora da lista: o perfil vem antes, depois a espera) → segue, não há casa para aceitar", async () => {
    results.profiles = { data: null, error: null };
    expect(await houseRedirect(client, "u")).toBeNull();
  });

  it("erro ao ler a casa ou o perfil → encerra a sessão, não libera", async () => {
    results.house_members = { data: null, error: { code: "PGRST301" } };
    expect(await houseRedirect(client, "u")).toBe("/auth/sair?motivo=failed");
    results.house_members = { data: null, error: null };
    results.profiles = { data: null, error: { code: "PGRST301" } };
    expect(await houseRedirect(client, "u")).toBe("/auth/sair?motivo=failed");
  });
});
