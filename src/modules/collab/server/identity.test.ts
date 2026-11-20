import { describe, expect, it, vi } from "vitest";
import { readTeamIdentity, saveTeamIdentity } from "./identity";

const teamId = "0b7e28b8-07cb-4f9e-a89c-3fa82944ce26";

describe("identidade da equipe (#56)", () => {
  it("lê lema, cores e emblema; sem permissão (nenhuma linha) volta null", async () => {
    // Arrange
    const withRow = vi.fn().mockResolvedValue({ data: [{ motto: "Juntos", colors: ["#000000", "#d4a537"], emblem: "tocha" }], error: null });
    const noRow = vi.fn().mockResolvedValue({ data: [], error: null });

    // Act
    const identity = await readTeamIdentity({ rpc: withRow }, teamId);
    const denied = await readTeamIdentity({ rpc: noRow }, teamId);

    // Assert
    expect(withRow).toHaveBeenCalledWith("team_identity", { p_team: teamId });
    expect(identity).toEqual({ motto: "Juntos", colors: ["#000000", "#d4a537"], emblem: "tocha" });
    expect(denied).toBeNull();
  });

  it("identidade ainda não definida vem com cores vazias", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [{ motto: null, colors: null, emblem: null }], error: null });

    expect(await readTeamIdentity({ rpc }, teamId)).toEqual({ motto: null, colors: [], emblem: null });
  });

  it("grava com 2 cores quando a terceira não é usada", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });

    const result = await saveTeamIdentity({ rpc }, { teamId, motto: " Juntos ", color1: "#000000", color2: "#D4A537", color3: "#ffffff", useColor3: null, emblem: "tocha" });

    expect(result).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("set_team_identity", { p_team: teamId, p_motto: "Juntos", p_colors: ["#000000", "#d4a537"], p_emblem: "tocha" });
  });

  it("grava 3 cores quando a terceira é marcada", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });

    await saveTeamIdentity({ rpc }, { teamId, motto: "", color1: "#000000", color2: "#d4a537", color3: "#ffffff", useColor3: "on", emblem: "escudo" });

    expect(rpc).toHaveBeenCalledWith("set_team_identity", expect.objectContaining({ p_colors: ["#000000", "#d4a537", "#ffffff"], p_motto: "" }));
  });

  it("recusa emblema fora do catálogo e cor inválida sem ir ao banco", async () => {
    const rpc = vi.fn();

    const badEmblem = await saveTeamIdentity({ rpc }, { teamId, motto: "", color1: "#000000", color2: "#d4a537", emblem: "caveira" });
    const badColor = await saveTeamIdentity({ rpc }, { teamId, motto: "", color1: "preto", color2: "#d4a537", emblem: "tocha" });

    expect(badEmblem).toEqual({ ok: false, error: "invalid" });
    expect(badColor).toEqual({ ok: false, error: "invalid" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("recusa do banco por permissão vira not_allowed", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { code: "42501", message: "x" } });

    const result = await saveTeamIdentity({ rpc }, { teamId, motto: "", color1: "#000000", color2: "#d4a537", emblem: "tocha" });

    expect(result).toEqual({ ok: false, error: "not_allowed" });
  });
});
