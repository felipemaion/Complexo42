// "Baixar meus dados" sem o aceite do termo (#11): acesso e portabilidade (LGPD art. 18) não
// dependem do aceite. O mock da sessão só tem requireHolderClient (a sessão, sem portão de acesso: quem
// está em espera também baixa, #130): se a rota usasse o portão do termo ou o de acesso, a chamada falharia.
import { describe, expect, it, vi } from "vitest";

const exportOwnData = vi.fn(async () => ({ status: "ok", body: "{}", filename: "meus-dados.json" }));
vi.mock("@/modules/privacy", async (original) => ({
  ...(await original<typeof import("@/modules/privacy")>()),
  exportOwnData: (...args: unknown[]) => (exportOwnData as (...a: unknown[]) => unknown)(...args),
}));
vi.mock("@/server/auth/config", () => ({ getAuthConfig: () => ({ siteUrl: "http://127.0.0.1:3000" }) }));
vi.mock("@/server/auth/session", () => ({
  requireHolderClient: async () => ({
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

  // #130: quem está em espera baixa pela tela /espera. Se der limite ou erro, volta para lá: o início mandaria a
  // pessoa de volta à espera sem o aviso.
  it("pedido vindo de /espera volta para /espera com o aviso (e só para ela; destino não vem do navegador)", async () => {
    exportOwnData.mockResolvedValueOnce({ status: "rate_limited" } as never);
    const form = new FormData();
    form.set("volta", "espera");
    const response = await POST(new Request("http://127.0.0.1:3000/meus-dados", { method: "POST", headers: { origin: "http://127.0.0.1:3000" }, body: form }) as never);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("http://127.0.0.1:3000/espera?dados=limite");

    exportOwnData.mockResolvedValueOnce({ status: "failed" } as never);
    const other = new FormData();
    other.set("volta", "https://mal.exemplo");
    const home = await POST(new Request("http://127.0.0.1:3000/meus-dados", { method: "POST", headers: { origin: "http://127.0.0.1:3000" }, body: other }) as never);
    expect(home.headers.get("location")).toBe("http://127.0.0.1:3000/inicio?dados=erro");
  });
});
