import { describe, expect, it, vi } from "vitest";
import { moveToTeam } from "./teams";

const person = "0b7e28b8-07cb-4f9e-a89c-3fa82944ce26";
const from = "c38bdfae-f1f4-41d6-b8db-41710928a38b";
const to = "11111111-1111-4111-8111-111111111111";

describe("mover pessoa entre equipes (#47)", () => {
  it("chama move_to_team com pessoa, origem e destino", async () => {
    // Arrange
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });

    // Act
    const result = await moveToTeam({ rpc }, { profileId: person, fromTeamId: from, toTeamId: to });

    // Assert
    expect(result).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("move_to_team", { p_profile: person, p_from: from, p_to: to });
  });

  it("destino vazio ou igual à origem nem vai ao banco", async () => {
    const rpc = vi.fn();

    expect(await moveToTeam({ rpc }, { profileId: person, fromTeamId: from, toTeamId: "" })).toEqual({ ok: false, error: "invalid" });
    expect(await moveToTeam({ rpc }, { profileId: person, fromTeamId: from, toTeamId: from })).toEqual({ ok: false, error: "invalid" });
    expect(rpc).not.toHaveBeenCalled();
  });
});
