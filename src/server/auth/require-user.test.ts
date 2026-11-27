// requireUser (#11): quem não aceitou o termo vigente vai para /termo; quem aceitou segue; a tela do
// termo (requireAccessUser) não exige o aceite, senão ninguém chegaria a ela.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { consentTerm } from "@config/consent";
import { instance } from "@config/instance";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ getAll: () => [{ name: "sb-app-auth-token", value: "a" }], set: () => {}, delete: () => {} }),
  headers: async () => new Headers(),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`);
  },
}));
vi.mock("./config", () => ({
  getAuthConfig: () => ({ internalUrl: "http://127.0.0.1:9", publicUrl: "http://127.0.0.1:9", anonKey: "k", siteUrl: "http://127.0.0.1:3000", trustCfConnectingIp: false }),
}));

let accepted: unknown = null;
let house: unknown = null;
const fake = {
  auth: { getUser: async () => ({ data: { user: { id: "u1", email: "pessoa@exemplo.org" } } }) },
  from: (table: string) => {
    const data = table === "profiles" ? { access_status: "active" } : table === "house_members" ? house : accepted;
    const chain = { select: () => chain, eq: () => chain, is: () => chain, not: () => chain, maybeSingle: async () => ({ data, error: null }) };
    return chain;
  },
};
vi.mock("./client", async (original) => ({ ...(await original<typeof import("./client")>()), createAuthClient: () => fake }));

const { requireUser, requireUserBeforeHouse, requireAccessUser } = await import("./session");

beforeEach(() => {
  accepted = null;
  house = null;
});

describe("requireUser e o termo", () => {
  it("sem aceite da versão vigente → /termo", async () => {
    await expect(requireUser()).rejects.toThrow("redirect:/termo");
  });

  it("com o aceite → segue, com o e-mail só mascarado", async () => {
    accepted = { version: consentTerm.version };
    house = { house_key: instance.houses[0]!.id };
    expect(await requireUser()).toEqual({ id: "u1", maskedEmail: expect.not.stringContaining("pessoa@") });
  });

  it("requireAccessUser (a tela do termo) não exige o aceite", async () => {
    expect((await requireAccessUser()).id).toBe("u1");
  });
});

describe("requireUser e a casa (ADR 0017)", () => {
  it("com o termo aceito mas sem casa → /casa (o perfil e o resto só depois)", async () => {
    accepted = { version: consentTerm.version };
    await expect(requireUser()).rejects.toThrow("redirect:/casa");
  });

  it("o termo geral vem antes da casa: sem o termo, /termo", async () => {
    await expect(requireUser()).rejects.toThrow("redirect:/termo");
  });

  it("requireUserBeforeHouse (só a tela da casa) segue sem casa, mas exige o termo", async () => {
    await expect(requireUserBeforeHouse()).rejects.toThrow("redirect:/termo");
    accepted = { version: consentTerm.version };
    expect((await requireUserBeforeHouse()).id).toBe("u1");
  });

  it("requireAccessUser (termo, meus dados, excluir conta) não exige casa", async () => {
    expect((await requireAccessUser()).id).toBe("u1");
  });
});
