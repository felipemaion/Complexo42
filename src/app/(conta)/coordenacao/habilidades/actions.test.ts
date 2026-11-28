// Decisão das sugestões de habilidade (#15): o guard da tela vale também na ação (R15); quem não é da
// coordenação nacional é recusado (404) sem chamar o banco.
import { beforeEach, describe, expect, it, vi } from "vitest";

const client = { rpc: async () => ({ data: null, error: null }), from: () => ({}) };
const decideSuggestion = vi.fn(async (..._a: unknown[]) => ({ ok: true as const }));
let national = true;
const guard = vi.fn(async (screen: string) => {
  if (!national) throw new Error("NEXT_NOT_FOUND");
  return { client, screen };
});

vi.mock("@/modules/houses", () => ({ requireCoordinationScreen: guard }));
vi.mock("@/modules/skills", () => ({ decideSuggestion }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));
vi.mock("@/server/log", () => ({ log: { info: () => {}, warn: () => {}, error: () => {} } }));

const { decideSuggestionAction } = await import("./actions");
const ID = "8f1c2a4e-0b5d-4c3a-9e7f-1a2b3c4d5e6f";

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
}

beforeEach(() => {
  national = true;
  guard.mockClear();
  decideSuggestion.mockClear();
});

describe("decideSuggestionAction", () => {
  it("quem não é da coordenação nacional é recusado, sem chamar o banco", async () => {
    national = false;
    await expect(decideSuggestionAction(form({ sugestao: ID, decisao: "aprovar", grupo: "Ofícios" }))).rejects.toThrow("NEXT_NOT_FOUND");
    expect(guard).toHaveBeenCalledWith("skills");
    expect(decideSuggestion).not.toHaveBeenCalled();
  });

  it("aprovar manda o grupo; rejeitar, não", async () => {
    await expect(decideSuggestionAction(form({ sugestao: ID, decisao: "aprovar", grupo: "Ofícios" }))).rejects.toThrow("REDIRECT:/coordenacao/habilidades?decidida=1");
    expect(decideSuggestion).toHaveBeenLastCalledWith(client, { suggestionId: ID, approve: true, category: "Ofícios" });
    await expect(decideSuggestionAction(form({ sugestao: ID, decisao: "rejeitar" }))).rejects.toThrow("REDIRECT:/coordenacao/habilidades?decidida=1");
    expect(decideSuggestion).toHaveBeenLastCalledWith(client, { suggestionId: ID, approve: false });
  });

  it("decisão fora da lista volta com erro, sem chamar o banco", async () => {
    await expect(decideSuggestionAction(form({ sugestao: ID, decisao: "talvez" }))).rejects.toThrow("REDIRECT:/coordenacao/habilidades?erro=invalid");
    expect(decideSuggestion).not.toHaveBeenCalled();
  });

  it("recusa do banco volta com o motivo", async () => {
    decideSuggestion.mockResolvedValueOnce({ ok: false, error: "not_found" } as never);
    await expect(decideSuggestionAction(form({ sugestao: ID, decisao: "rejeitar" }))).rejects.toThrow("REDIRECT:/coordenacao/habilidades?erro=not_found");
  });
});
