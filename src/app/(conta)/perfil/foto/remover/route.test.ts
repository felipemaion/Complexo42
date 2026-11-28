// Remover a própria foto (#308): mesma chave, mesma origem, e 404 com a chave desligada.
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = { enabled: false };
vi.mock("@config/instance", () => ({ instance: { profile: { get photoEnabled() { return state.enabled; } } } }));
const removeOwnPhoto = vi.fn<(...args: unknown[]) => Promise<boolean>>();
vi.mock("@/modules/profiles", async (original) => ({
  ...(await original<typeof import("@/modules/profiles")>()),
  removeOwnPhoto: (...args: unknown[]) => removeOwnPhoto(...args),
}));
vi.mock("@/server/auth/config", () => ({ getAuthConfig: () => ({ siteUrl: "http://127.0.0.1:3000" }) }));
const requireUserClient = vi.fn(async () => ({ user: { id: "u1" }, client: {} }));
vi.mock("@/server/auth/session", () => ({ requireUserClient: () => requireUserClient() }));

const { POST } = await import("./route");
const ORIGIN = "http://127.0.0.1:3000";
const post = (origin: string | null = ORIGIN) =>
  new Request(`${ORIGIN}/perfil/foto/remover`, { method: "POST", headers: origin ? { origin } : {} });
const search = (response: Response) => new URL(response.headers.get("location") ?? "http://x/").search;

beforeEach(() => {
  state.enabled = true;
  removeOwnPhoto.mockReset();
  removeOwnPhoto.mockResolvedValue(true);
  requireUserClient.mockClear();
});

describe("POST /perfil/foto/remover", () => {
  it("chave desligada: 404 sem sessão e sem tocar no banco", async () => {
    state.enabled = false;
    expect((await POST(post() as never)).status).toBe(404);
    expect(requireUserClient).not.toHaveBeenCalled();
    expect(removeOwnPhoto).not.toHaveBeenCalled();
  });

  it("origem de outro site: 403", async () => {
    expect((await POST(post("https://outro.example") as never)).status).toBe(403);
    expect(removeOwnPhoto).not.toHaveBeenCalled();
  });

  it("remove e volta ao perfil com ?foto=removida; erro vira ?foto=erro", async () => {
    const response = await POST(post() as never);
    expect([response.status, search(response)]).toEqual([303, "?foto=removida"]);
    removeOwnPhoto.mockResolvedValue(false);
    expect(search(await POST(post() as never))).toBe("?foto=erro");
  });
});
