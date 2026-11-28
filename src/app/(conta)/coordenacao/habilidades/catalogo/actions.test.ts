// Gestão do catálogo (#25): o guard da tela vale também na ação (R15); quem não é da coordenação nacional é
// recusado (404) sem chamar o banco, e cada ação chama só a função do banco que lhe cabe.
import { beforeEach, describe, expect, it, vi } from "vitest";

const client = { rpc: async () => ({ data: null, error: null }), from: () => ({}) };
type Outcome = { ok: boolean; error?: string };
const ok = async (): Promise<Outcome> => ({ ok: true });
const fns = {
  createSkill: vi.fn<(c: unknown, i: unknown) => Promise<Outcome>>(ok),
  renameSkill: vi.fn<(c: unknown, i: unknown) => Promise<Outcome>>(ok),
  moveSkill: vi.fn<(c: unknown, i: unknown) => Promise<Outcome>>(ok),
  renameSkillGroup: vi.fn<(c: unknown, i: unknown) => Promise<Outcome>>(ok),
  setSkillActive: vi.fn<(c: unknown, i: unknown) => Promise<Outcome>>(ok),
  mergeSkills: vi.fn<(c: unknown, i: unknown) => Promise<Outcome>>(ok),
};
let national = true;
const guard = vi.fn(async (screen: string) => {
  if (!national) throw new Error("NEXT_NOT_FOUND");
  return { client, screen };
});

vi.mock("@/modules/houses", () => ({ requireCoordinationScreen: guard }));
vi.mock("@/modules/skills", () => fns);
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));
vi.mock("@/server/log", () => ({ log: { info: () => {}, warn: () => {}, error: () => {} } }));

const { catalogAction } = await import("./actions");
const ID = "8f1c2a4e-0b5d-4c3a-9e7f-1a2b3c4d5e6f";
const ID2 = "9a1c2a4e-0b5d-4c3a-9e7f-1a2b3c4d5e70";
const DONE = "REDIRECT:/coordenacao/habilidades/catalogo?feito=1";

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
}

beforeEach(() => {
  national = true;
  guard.mockClear();
  for (const fn of Object.values(fns)) fn.mockClear();
});

describe("catalogAction", () => {
  it("quem não é da coordenação nacional é recusado, sem chamar o banco", async () => {
    national = false;
    await expect(catalogAction(form({ acao: "criar", nome: "Soldagem", grupo: "Ofícios" }))).rejects.toThrow("NEXT_NOT_FOUND");
    expect(guard).toHaveBeenCalledWith("skills");
    for (const fn of Object.values(fns)) expect(fn).not.toHaveBeenCalled();
  });

  it("cada ação chama só a sua função", async () => {
    await expect(catalogAction(form({ acao: "criar", nome: "Soldagem", grupo: "Ofícios" }))).rejects.toThrow(DONE);
    expect(fns.createSkill).toHaveBeenLastCalledWith(client, { name: "Soldagem", category: "Ofícios" });
    await expect(catalogAction(form({ acao: "renomear", habilidade: ID, nome: "Solda" }))).rejects.toThrow(DONE);
    expect(fns.renameSkill).toHaveBeenLastCalledWith(client, { id: ID, name: "Solda" });
    await expect(catalogAction(form({ acao: "mover", habilidade: ID, grupo: "Esportes" }))).rejects.toThrow(DONE);
    expect(fns.moveSkill).toHaveBeenLastCalledWith(client, { id: ID, category: "Esportes" });
    await expect(catalogAction(form({ acao: "renomear-grupo", grupo: "Ofícios", novo: "Trabalho manual" }))).rejects.toThrow(DONE);
    expect(fns.renameSkillGroup).toHaveBeenLastCalledWith(client, { from: "Ofícios", to: "Trabalho manual" });
    await expect(catalogAction(form({ acao: "desativar", habilidade: ID }))).rejects.toThrow(DONE);
    expect(fns.setSkillActive).toHaveBeenLastCalledWith(client, { id: ID, active: false });
    await expect(catalogAction(form({ acao: "reativar", habilidade: ID }))).rejects.toThrow(DONE);
    expect(fns.setSkillActive).toHaveBeenLastCalledWith(client, { id: ID, active: true });
    await expect(catalogAction(form({ acao: "mesclar", habilidade: ID, destino: ID2 }))).rejects.toThrow(DONE);
    expect(fns.mergeSkills).toHaveBeenLastCalledWith(client, { from: ID, to: ID2 });
  });

  it("ação desconhecida volta com erro, sem chamar o banco", async () => {
    await expect(catalogAction(form({ acao: "apagar", habilidade: ID }))).rejects.toThrow("REDIRECT:/coordenacao/habilidades/catalogo?erro=invalid");
    for (const fn of Object.values(fns)) expect(fn).not.toHaveBeenCalled();
  });

  it("recusa do banco volta com o código do erro", async () => {
    fns.mergeSkills.mockResolvedValueOnce({ ok: false, error: "merge_invalid" });
    await expect(catalogAction(form({ acao: "mesclar", habilidade: ID, destino: ID }))).rejects.toThrow("REDIRECT:/coordenacao/habilidades/catalogo?erro=merge_invalid");
  });
});
