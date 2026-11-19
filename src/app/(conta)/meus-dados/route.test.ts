// "Baixar meus dados" sem o aceite do termo (#11): acesso e portabilidade (LGPD art. 18) não
// dependem do aceite. O mock da sessão só tem requireAccessUserClient: se a rota usasse o portão
// do termo (requireUserClient), a chamada falharia.
import { describe, expect, it, vi } from "vitest";

const exportOwnData = vi.fn(async () => ({ status: "ok", body: "{}", filename: "meus-dados.json" }));
vi.mock("@/modules/privacy", async (original) => ({
  ...(await original<typeof import("@/modules/privacy")>()),
  exportOwnData: (...args: unknown[]) => (exportOwnData as (...a: unknown[]) => unknown)(...args),
}));
vi.mock("@/server/auth/config", () => ({ getAuthConfig: () => ({ siteUrl: "http://127.0.0.1:3000" }) }));
vi.mock("@/server/auth/session", () => ({
  requireAccessUserClient: async () => ({
    user: { id: "u1" },
    client: { auth: { getUser: async () => ({ data: { user: { email: "pessoa@exemplo.org" } } }) } },
  }),
}));

const { POST } = await import("./route");

describe("POST /meus-dados", () => {
  it("baixa o arquivo mesmo sem ter aceitado o termo", async () => {
    const request = new Request("http://127.0.0.1:3000/meus-dados", { method: "POST", headers: { origin: "http://127.0.0.1:3000" } });
    const response = await POST(request as never);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Disposition")).toContain("meus-dados.json");
    expect(exportOwnData).toHaveBeenCalledOnce();
  });
});
