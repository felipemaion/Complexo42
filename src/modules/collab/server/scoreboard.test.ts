import { describe, expect, it, vi } from "vitest";
import { parsePeriod, readScoreboard } from "./scoreboard";

const team = "0b7e28b8-07cb-4f9e-a89c-3fa82944ce26";

describe("placar de equipes (#58)", () => {
  it("só aceita os períodos da tela; o resto vira 'desde o início'", () => {
    // Arrange / Act / Assert
    expect(parsePeriod("7")).toBe(7);
    expect(parsePeriod("30")).toBe(30);
    expect(parsePeriod("999")).toBeNull();
    expect(parsePeriod(undefined)).toBeNull();
  });

  it("lê o placar do período e calcula a posição (empate divide a posição)", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [
        { team_id: team, team_name: "Saúde", points: 60, is_mine: false },
        { team_id: "c38bdfae-f1f4-41d6-b8db-41710928a38b", team_name: "Orçamento", points: 60, is_mine: true },
        { team_id: "11111111-1111-4111-8111-111111111111", team_name: "Educação", points: 20, is_mine: false },
      ],
      error: null,
    });

    const rows = await readScoreboard({ rpc }, 30);

    expect(rpc).toHaveBeenCalledWith("team_scoreboard", { p_scope: null, p_days: 30 });
    expect(rows.map((r) => `${r.position}:${r.teamName}:${r.isMine}`)).toEqual(["1:Saúde:false", "1:Orçamento:true", "3:Educação:false"]);
  });
});
