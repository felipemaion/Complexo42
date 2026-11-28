// Envio da foto (#308): atrás da chave `profile.photoEnabled` (desligada por padrão: 404), só do
// mesmo site, com o corpo limitado ANTES de ler, e sempre resposta com redirect (o navegador volta
// com GET). O serviço (conversão, cifra, banco) é testado em src/modules/profiles/server/photo.test.ts.
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = { enabled: false };
vi.mock("@config/instance", () => ({ instance: { profile: { get photoEnabled() { return state.enabled; } } } }));
const savePhoto = vi.fn<(...args: unknown[]) => Promise<{ status: string }>>();
vi.mock("@/modules/profiles", async (original) => ({
  ...(await original<typeof import("@/modules/profiles")>()),
  savePhoto: (...args: unknown[]) => savePhoto(...args),
}));
vi.mock("@/server/auth/config", () => ({ getAuthConfig: () => ({ siteUrl: "http://127.0.0.1:3000" }) }));
const requireUserClient = vi.fn(async () => ({ user: { id: "u1" }, client: {} }));
vi.mock("@/server/auth/session", () => ({ requireUserClient: () => requireUserClient() }));

const { POST } = await import("./route");

const ORIGIN = "http://127.0.0.1:3000";
function upload(opts: { origin?: string | null; file?: Blob | null; headers?: Record<string, string> } = {}): Request {
  const form = new FormData();
  if (opts.file !== null) form.set("photo", opts.file ?? new File([Uint8Array.of(0xff, 0xd8, 0xff, 1, 2, 3)], "eu.jpg", { type: "image/jpeg" }));
  const headers: Record<string, string> = { ...(opts.origin === null ? {} : { origin: opts.origin ?? ORIGIN }), ...opts.headers };
  return new Request(`${ORIGIN}/perfil/foto`, { method: "POST", body: form, headers });
}
const locationOf = (response: Response) => new URL(response.headers.get("location") ?? "http://x/").search;

beforeEach(() => {
  state.enabled = true;
  savePhoto.mockReset();
  savePhoto.mockResolvedValue({ status: "saved" });
  requireUserClient.mockClear();
});

describe("POST /perfil/foto", () => {
  it("chave desligada (o padrão): 404, sem sessão, sem ler o corpo e sem chamar o serviço", async () => {
    state.enabled = false;
    const response = await POST(upload() as never);
    expect(response.status).toBe(404);
    expect(requireUserClient).not.toHaveBeenCalled();
    expect(savePhoto).not.toHaveBeenCalled();
  });

  it("origem de outro site (ou sem origem): 403", async () => {
    expect((await POST(upload({ origin: "https://outro.example" }) as never)).status).toBe(403);
    expect((await POST(upload({ origin: null }) as never)).status).toBe(403);
    expect(savePhoto).not.toHaveBeenCalled();
  });

  it("envio válido: chama o serviço com os bytes, e volta ao perfil com ?foto=ok (303, sem cache)", async () => {
    const response = await POST(upload() as never);
    expect(response.status).toBe(303);
    expect(locationOf(response)).toBe("?foto=ok");
    expect(new URL(response.headers.get("location")!).pathname).toBe("/perfil");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const sent = savePhoto.mock.calls[0]![2] as Uint8Array;
    expect([...sent]).toEqual([0xff, 0xd8, 0xff, 1, 2, 3]);
  });

  it.each([
    ["invalid_type", "tipo"],
    ["too_large", "grande"],
    ["unreadable", "ilegivel"],
    ["too_many_attempts", "limite"],
    ["forbidden", "erro"],
    ["failed", "erro"],
  ])("resultado %s do serviço vira ?foto=%s", async (status, param) => {
    savePhoto.mockResolvedValue({ status });
    expect(locationOf(await POST(upload() as never))).toBe(`?foto=${param}`);
  });

  it("sem arquivo, ou o campo não é arquivo: ?foto=tipo, sem chamar o serviço", async () => {
    expect(locationOf(await POST(upload({ file: null }) as never))).toBe("?foto=tipo");
    expect(savePhoto).not.toHaveBeenCalled();
  });

  it("Content-Length acima do teto: recusa sem ler o corpo (?foto=grande)", async () => {
    const request = upload({ headers: { "content-length": String(50 * 1024 * 1024) } });
    const read = vi.spyOn(request, "formData");
    expect(locationOf(await POST(request as never))).toBe("?foto=grande");
    expect(read).not.toHaveBeenCalled();
    expect(savePhoto).not.toHaveBeenCalled();
  });

  it("corpo que passa do teto sem declarar o tamanho: corta a leitura no limite (?foto=grande)", async () => {
    let pulls = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls++;
        controller.enqueue(new Uint8Array(256 * 1024));
      },
    });
    const request = new Request(`${ORIGIN}/perfil/foto`, {
      method: "POST",
      body,
      headers: { origin: ORIGIN, "content-type": "multipart/form-data; boundary=x" },
      duplex: "half",
    } as RequestInit);
    expect(locationOf(await POST(request as never))).toBe("?foto=grande");
    expect(pulls).toBeLessThan(40);
    expect(savePhoto).not.toHaveBeenCalled();
  });
});
