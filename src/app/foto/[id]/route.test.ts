// Leitura da foto (#308): só com sessão (o proxy já manda quem não tem para o login), sempre
// `private, no-store` e `noindex`; quem não pode ver recebe 404, igual a "sem foto" (a RLS decide).
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = { enabled: true };
vi.mock("@config/instance", () => ({ instance: { profile: { get photoEnabled() { return state.enabled; } } } }));
const loadPhoto = vi.fn<(...args: unknown[]) => Promise<Buffer | null>>();
vi.mock("@/modules/profiles", async (original) => ({
  ...(await original<typeof import("@/modules/profiles")>()),
  loadPhoto: (...args: unknown[]) => loadPhoto(...args),
}));
const requireUserClient = vi.fn(async () => ({ user: { id: "u1" }, client: { marcador: "jwt-da-pessoa" } }));
vi.mock("@/server/auth/session", () => ({ requireUserClient: () => requireUserClient() }));

const { GET } = await import("./route");
const ID = "1c7a3e5f-4d2b-4a9f-8e3c-8b6d7f2a1b04";
const get = (id: string) => GET(new Request(`http://127.0.0.1:3000/foto/${id}`) as never, { params: Promise.resolve({ id }) });

beforeEach(() => {
  state.enabled = true;
  loadPhoto.mockReset();
  requireUserClient.mockClear();
});

describe("GET /foto/<id>", () => {
  it("devolve a miniatura com cabeçalhos que impedem cache compartilhado e indexação", async () => {
    loadPhoto.mockResolvedValue(Buffer.from("RIFFxxxxWEBPVP8 "));
    const response = await get(ID);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/webp");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(Buffer.from(await response.arrayBuffer()).toString()).toBe("RIFFxxxxWEBPVP8 ");
    // Lê com o cliente da própria pessoa (JWT), nunca com chave de serviço.
    expect(loadPhoto.mock.calls[0]![0]).toEqual({ marcador: "jwt-da-pessoa" });
    expect(loadPhoto.mock.calls[0]![1]).toBe(ID);
  });

  it("sem foto, ou sem permissão para vê-la: o mesmo 404, sem dizer qual", async () => {
    loadPhoto.mockResolvedValue(null);
    const response = await get(ID);
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.text()).toBe("");
  });

  it("chave desligada (o padrão): 404 em qualquer caso, sem sessão e sem tocar no banco (nada de foto em lugar nenhum)", async () => {
    state.enabled = false;
    loadPhoto.mockResolvedValue(Buffer.from("RIFFxxxxWEBPVP8 "));
    const response = await get(ID);
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(requireUserClient).not.toHaveBeenCalled();
    expect(loadPhoto).not.toHaveBeenCalled();
  });

  it("id que não é uuid: 404, sem sessão consultada nem banco", async () => {
    expect((await get("../etc/passwd")).status).toBe(404);
    expect(loadPhoto).not.toHaveBeenCalled();
  });
});
