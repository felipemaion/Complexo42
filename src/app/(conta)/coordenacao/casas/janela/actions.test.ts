// Server action da janela de transferência (#302): o guard da tela vale também na ação (R15, a ação é
// um endpoint). Quem não é da coordenação nacional é recusado (404) sem chamar o banco.
import { beforeEach, describe, expect, it, vi } from "vitest";

const client = { rpc: async () => ({ data: null, error: null }) };
const setTransferWindow = vi.fn(async () => ({ ok: true as const }));
let national = true;
const guard = vi.fn(async (screen: string) => {
  if (!national) throw new Error("NEXT_NOT_FOUND");
  return { client, screen };
});

vi.mock("@/modules/houses", () => ({ requireCoordinationScreen: guard, setTransferWindow }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));
vi.mock("@/server/log", () => ({ log: { info: () => {}, warn: () => {}, error: () => {} } }));

const { setTransferWindowAction } = await import("./actions");

function form(estado: string): FormData {
  const data = new FormData();
  data.set("estado", estado);
  return data;
}

beforeEach(() => {
  national = true;
  guard.mockClear();
  setTransferWindow.mockClear();
});

describe("setTransferWindowAction", () => {
  it("quem não é da coordenação nacional é recusado, sem chamar o banco", async () => {
    national = false;
    await expect(setTransferWindowAction(form("aberta"))).rejects.toThrow("NEXT_NOT_FOUND");
    expect(guard).toHaveBeenCalledWith("window");
    expect(setTransferWindow).not.toHaveBeenCalled();
  });

  it("a nacional abre e fecha com o cliente da sessão", async () => {
    await expect(setTransferWindowAction(form("aberta"))).rejects.toThrow("REDIRECT:/coordenacao/casas/janela");
    expect(setTransferWindow).toHaveBeenLastCalledWith(client, { open: true });
    await expect(setTransferWindowAction(form("fechada"))).rejects.toThrow("REDIRECT:/coordenacao/casas/janela");
    expect(setTransferWindow).toHaveBeenLastCalledWith(client, { open: false });
  });

  it("estado inválido volta com erro, sem chamar o banco", async () => {
    await expect(setTransferWindowAction(form("talvez"))).rejects.toThrow("REDIRECT:/coordenacao/casas/janela?erro=invalid");
    expect(setTransferWindow).not.toHaveBeenCalled();
  });
});
