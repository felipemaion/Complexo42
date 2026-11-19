// requireUser (#11): quem não aceitou o termo vigente vai para /termo; quem aceitou segue; a tela do
// termo (requireAccessUser) não exige o aceite, senão ninguém chegaria a ela.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { consentTerm } from "@config/consent";

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
const fake = {
  auth: { getUser: async () => ({ data: { user: { id: "u1", email: "pessoa@exemplo.org" } } }) },
  from: (table: string) => {
    const chain = { select: () => chain, eq: () => chain, maybeSingle: async () => ({ data: table === "profiles" ? { access_status: "active" } : accepted, error: null }) };
    return chain;
  },
};
vi.mock("./client", async (original) => ({ ...(await original<typeof import("./client")>()), createAuthClient: () => fake }));

const { requireUser, requireAccessUser } = await import("./session");

beforeEach(() => {
  accepted = null;
});

describe("requireUser e o termo", () => {
  it("sem aceite da versão vigente → /termo", async () => {
    await expect(requireUser()).rejects.toThrow("redirect:/termo");
  });

  it("com o aceite → segue, com o e-mail só mascarado", async () => {
    accepted = { version: consentTerm.version };
    expect(await requireUser()).toEqual({ id: "u1", maskedEmail: expect.not.stringContaining("pessoa@") });
  });

  it("requireAccessUser (a tela do termo) não exige o aceite", async () => {
    expect((await requireAccessUser()).id).toBe("u1");
  });
});
