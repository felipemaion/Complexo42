import { describe, expect, it, vi } from "vitest";
import type { SearchClient } from "../types";
import { readMySkillIds, readSelectableSkills, saveMySkills } from "./my-skills";

const A = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";
const B = "b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a12";

/** Cliente falso: `from(...).select(...).order(...).order(...)` resolve com `table`; rpc com `rpc`. */
function makeClient(table: { data: unknown; error: unknown }, rpc: unknown = vi.fn()): SearchClient {
  const query = { order: () => query, then: (resolve: (v: unknown) => unknown) => resolve(table) };
  return { rpc, from: () => ({ select: () => query }) } as unknown as SearchClient;
}

describe("habilidades da própria pessoa (#15)", () => {
  it("o catálogo para marcar traz só as ativas", async () => {
    // Arrange
    const client = makeClient({
      data: [
        { id: A, name: "Oratória", category: "Comunicação", aliases: ["falar em público"], active: true },
        { id: B, name: "Antiga", category: "Comunicação", aliases: [], active: false },
      ],
      error: null,
    });

    // Act
    const skills = await readSelectableSkills(client);

    // Assert
    expect(skills).toEqual([{ id: A, name: "Oratória", category: "Comunicação", aliases: ["falar em público"] }]);
  });

  it("erro ou formato estranho do banco viram exceção (a tela registra)", async () => {
    await expect(readSelectableSkills(makeClient({ data: null, error: { code: "42501" } }))).rejects.toThrow("skills_read_failed");
    await expect(readSelectableSkills(makeClient({ data: [{ id: "x" }], error: null }))).rejects.toThrow("skills_read_failed");
    const odd = vi.fn().mockResolvedValue({ data: [{ skill_id: "x" }], error: null });
    await expect(readMySkillIds(makeClient({ data: [], error: null }, odd))).rejects.toThrow("my_skills_read_failed");
  });

  it("lê os ids marcados", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [{ skill_id: A }, { skill_id: B }], error: null });

    expect(await readMySkillIds(makeClient({ data: [], error: null }, rpc))).toEqual([A, B]);
    expect(rpc).toHaveBeenCalledWith("my_skills", {});
  });

  it("salva sem repetidos e devolve quantas a pessoa tem", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: 2, error: null });

    const result = await saveMySkills(makeClient({ data: [], error: null }, rpc), [A, B, A]);

    expect(result).toEqual({ ok: true, count: 2 });
    expect(rpc).toHaveBeenCalledWith("set_my_skills", { p_skills: [A, B] });
  });

  it("recusa antes do banco: id inválido e mais de 12", async () => {
    const rpc = vi.fn();
    const many = Array.from({ length: 13 }, (_, i) => `a0eebc99-9c0b-4ef8-bb6d-6bb9bd38${String(i).padStart(4, "0")}`);

    expect(await saveMySkills(makeClient({ data: [], error: null }, rpc), ["../x"])).toEqual({ ok: false, error: "invalid" });
    expect(await saveMySkills(makeClient({ data: [], error: null }, rpc), many)).toEqual({ ok: false, error: "too_many" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("traduz os erros do banco", async () => {
    const answer = (code: string, message = "x") => vi.fn().mockResolvedValue({ data: null, error: { code, message } });
    const save = (rpc: unknown) => saveMySkills(makeClient({ data: [], error: null }, rpc), [A]);

    expect(await save(answer("42501"))).toEqual({ ok: false, error: "not_allowed" });
    expect(await save(answer("22023", "até 12 habilidades"))).toEqual({ ok: false, error: "too_many" });
    expect(await save(answer("22023", "habilidade fora do catálogo ativo"))).toEqual({ ok: false, error: "invalid" });
    expect(await save(answer("XX000"))).toEqual({ ok: false, error: "failed" });
  });
});
