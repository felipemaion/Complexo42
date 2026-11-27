import { describe, expect, it, vi } from "vitest";
import { parseAliases, saveSkill, toggleSkill } from "./catalog";

const skill = "0b7e28b8-07cb-4f9e-a89c-3fa82944ce26";

describe("catálogo de habilidades (#25)", () => {
  it("sinônimos separados por vírgula viram lista limpa", () => {
    // Arrange / Act / Assert
    expect(parseAliases(" Libras, língua de sinais ,, x ")).toEqual(["Libras", "língua de sinais"]);
  });

  it("sem id cria; com id edita", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: skill, error: null });

    await saveSkill({ rpc }, { skillId: "", name: "Libras", category: "Comunicação e oratória", aliases: "libras, sinais" });
    await saveSkill({ rpc }, { skillId: skill, name: "Libras", category: "Comunicação e oratória", aliases: "" });

    expect(rpc).toHaveBeenNthCalledWith(1, "create_skill", { p_name: "Libras", p_category: "Comunicação e oratória", p_aliases: ["libras", "sinais"] });
    expect(rpc).toHaveBeenNthCalledWith(2, "update_skill", { p_skill: skill, p_name: "Libras", p_category: "Comunicação e oratória", p_aliases: [] });
  });

  it("nome repetido e sem permissão viram erros conhecidos", async () => {
    const dup = vi.fn().mockResolvedValue({ data: null, error: { code: "23505" } });
    const denied = vi.fn().mockResolvedValue({ data: null, error: { code: "42501" } });

    expect(await saveSkill({ rpc: dup }, { skillId: "", name: "Libras", category: "Outra", aliases: "" })).toEqual({ ok: false, error: "duplicate" });
    expect(await toggleSkill({ rpc: denied }, { skillId: skill, active: "false" })).toEqual({ ok: false, error: "not_allowed" });
  });
});
