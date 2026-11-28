// Server actions das novidades (#307): sem papel de gestor a ação nem chega ao banco (R15, a ação é um endpoint);
// formulário inválido volta com erro; recusa do banco volta com o motivo curto.
import { beforeEach, describe, expect, it, vi } from "vitest";

const UNIT = "11111111-1111-4111-8111-111111111111";
const houseClient = { rpc: async () => ({ data: null, error: null }) };
let manager = true;
const publishNews = vi.fn(async (): Promise<{ ok: true; id: string } | { ok: false; error: string }> => ({ ok: true, id: UNIT }));
const archiveNews = vi.fn(async (): Promise<{ ok: true } | { ok: false; error: string }> => ({ ok: true }));

vi.mock("@/modules/houses", async () => {
  const { parseNewsForm } = await import("@/modules/houses/domain/news-form");
  return { parseNewsForm, publishNews, archiveNews, sessionHouseClient: async () => houseClient };
});
vi.mock("@/modules/access", () => ({ readCoordinationMenu: async () => ({ waitlist: manager, allowlist: false }) }));
vi.mock("@/server/auth/session", () => ({ requireUserClient: async () => ({ user: { id: "u" }, client: {} }) }));
vi.mock("@/server/auth/routes", () => ({ HOME_PATH: "/inicio" }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));
vi.mock("@/server/log", () => ({ log: { info: () => {}, warn: () => {}, error: () => {} } }));

const { archiveNewsAction, publishNewsAction } = await import("./actions");

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}
const valid = { unidade: UNIT, titulo: "Encontro", texto: "Sábado, 10h.", link: "", validade: "" };

beforeEach(() => {
  manager = true;
  publishNews.mockClear();
  archiveNews.mockClear();
});

describe("publishNewsAction", () => {
  it("quem não é gestor volta para a página inicial, sem chamar o banco", async () => {
    manager = false;
    await expect(publishNewsAction(form(valid))).rejects.toThrow("REDIRECT:/inicio");
    expect(publishNews).not.toHaveBeenCalled();
  });

  it("gestor publica com o cliente da sessão", async () => {
    await expect(publishNewsAction(form(valid))).rejects.toThrow("REDIRECT:/coordenacao/novidades?ok=publicada");
    expect(publishNews).toHaveBeenCalledWith(houseClient, { unitId: UNIT, title: "Encontro", body: "Sábado, 10h.", link: null, expiresAt: null });
  });

  it("formulário inválido volta com erro, sem chamar o banco", async () => {
    await expect(publishNewsAction(form({ ...valid, link: "http://exemplo.org" }))).rejects.toThrow("REDIRECT:/coordenacao/novidades?erro=invalid");
    expect(publishNews).not.toHaveBeenCalled();
  });

  it("recusa do banco volta com o motivo curto", async () => {
    publishNews.mockResolvedValueOnce({ ok: false, error: "forbidden" });
    await expect(publishNewsAction(form(valid))).rejects.toThrow("REDIRECT:/coordenacao/novidades?erro=forbidden");
  });
});

describe("archiveNewsAction", () => {
  it("quem não é gestor não chega ao banco", async () => {
    manager = false;
    await expect(archiveNewsAction(form({ id: UNIT }))).rejects.toThrow("REDIRECT:/inicio");
    expect(archiveNews).not.toHaveBeenCalled();
  });

  it("gestor arquiva; recusa volta com o motivo", async () => {
    await expect(archiveNewsAction(form({ id: UNIT }))).rejects.toThrow("REDIRECT:/coordenacao/novidades?ok=arquivada");
    expect(archiveNews).toHaveBeenCalledWith(houseClient, { id: UNIT });
    archiveNews.mockResolvedValueOnce({ ok: false, error: "forbidden" });
    await expect(archiveNewsAction(form({ id: UNIT }))).rejects.toThrow("REDIRECT:/coordenacao/novidades?erro=forbidden");
  });
});
