// Portão da casa (ADR 0017): quem não tem vínculo de casa aberto e aceito vai para /casa; erro nega (falha fechada).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { instance } from "@config/instance";

vi.mock("server-only", () => ({}));
let result: { data: unknown; error: unknown } = { data: null, error: null };
const calls: unknown[][] = [];
const query = {
  eq: (...args: unknown[]) => (calls.push(["eq", ...args]), query),
  is: (...args: unknown[]) => (calls.push(["is", ...args]), query),
  not: (...args: unknown[]) => (calls.push(["not", ...args]), query),
  maybeSingle: async () => result,
};
const client = { from: (table: string) => (calls.push(["from", table]), { select: () => query }) } as never;

const { houseRedirect } = await import("./house-gate");

beforeEach(() => {
  result = { data: null, error: null };
  calls.length = 0;
});

describe("houseRedirect", () => {
  it("com a casa aceita (vínculo aberto, de uma casa da instância) → segue", async () => {
    result = { data: { house_key: instance.houses[0]!.id }, error: null };
    expect(await houseRedirect(client, "u")).toBeNull();
    expect(calls).toContainEqual(["from", "house_members"]);
    expect(calls).toContainEqual(["eq", "profile_id", "u"]);
    expect(calls).toContainEqual(["is", "left_at", null]);
    expect(calls).toContainEqual(["not", "accepted_at", "is", null]);
  });

  it("sem casa aceita → vai a /casa", async () => {
    expect(await houseRedirect(client, "u")).toBe("/casa");
  });

  it("vínculo de uma casa que não existe na instância não vale → /casa", async () => {
    result = { data: { house_key: "casa-inexistente" }, error: null };
    expect(await houseRedirect(client, "u")).toBe("/casa");
  });

  it("erro ao ler → encerra a sessão, não libera", async () => {
    result = { data: null, error: { code: "PGRST301" } };
    expect(await houseRedirect(client, "u")).toBe("/auth/sair?motivo=failed");
  });
});
