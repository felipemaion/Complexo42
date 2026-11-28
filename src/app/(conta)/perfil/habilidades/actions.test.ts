// Ações das habilidades da pessoa (#15): sessão (R14) e as funções do módulo; o banco decide e limita.
import { beforeEach, describe, expect, it, vi } from "vitest";

const client = { rpc: async () => ({ data: null, error: null }), from: () => ({}) };
const setMySkills = vi.fn(async (..._a: unknown[]) => ({ ok: true as const }));
const suggestSkill = vi.fn(async (..._a: unknown[]) => ({ ok: true as const }));
const requireUserClient = vi.fn(async () => ({ user: { id: "u1" }, client: {} }));

vi.mock("@/modules/houses", () => ({ sessionHouseClient: async () => client }));
vi.mock("@/modules/skills", () => ({ setMySkills, suggestSkill }));
vi.mock("@/server/auth/session", () => ({ requireUserClient }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));
vi.mock("@/server/log", () => ({ log: { info: () => {}, warn: () => {}, error: () => {} } }));

const { saveSkillsAction, suggestSkillAction } = await import("./actions");

function form(entries: [string, string][]): FormData {
  const data = new FormData();
  for (const [k, v] of entries) data.append(k, v);
  return data;
}

beforeEach(() => {
  setMySkills.mockClear();
  suggestSkill.mockClear();
  requireUserClient.mockClear();
});

describe("saveSkillsAction", () => {
  it("exige a sessão e manda os ids marcados", async () => {
    await expect(saveSkillsAction(form([["habilidade", "a"], ["habilidade", "b"]]))).rejects.toThrow("REDIRECT:/perfil/habilidades?salvo=1");
    expect(requireUserClient).toHaveBeenCalled();
    expect(setMySkills).toHaveBeenCalledWith(client, { skillIds: ["a", "b"] });
  });

  it("sem nada marcado, limpa (lista vazia)", async () => {
    await expect(saveSkillsAction(form([]))).rejects.toThrow("REDIRECT:/perfil/habilidades?salvo=1");
    expect(setMySkills).toHaveBeenCalledWith(client, { skillIds: [] });
  });

  it("recusa do banco volta com o motivo", async () => {
    setMySkills.mockResolvedValueOnce({ ok: false, error: "limit" } as never);
    await expect(saveSkillsAction(form([["habilidade", "a"]]))).rejects.toThrow("REDIRECT:/perfil/habilidades?erro=limit");
  });
});

describe("suggestSkillAction", () => {
  it("manda o nome digitado e volta com o aviso", async () => {
    await expect(suggestSkillAction(form([["nome", "Teatro de rua"]]))).rejects.toThrow("REDIRECT:/perfil/habilidades?sugerida=1");
    expect(suggestSkill).toHaveBeenCalledWith(client, { name: "Teatro de rua" });
  });

  it("recusa com o motivo (limite, já existe...)", async () => {
    suggestSkill.mockResolvedValueOnce({ ok: false, error: "exists" } as never);
    await expect(suggestSkillAction(form([["nome", "Teatro"]]))).rejects.toThrow("REDIRECT:/perfil/habilidades?erro=exists");
  });
});
