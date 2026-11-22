import { describe, expect, it, vi } from "vitest";
import { addPriorTeam, readPriorTeams, removePriorTeam } from "./prior-teams";

const person = "0b7e28b8-07cb-4f9e-a89c-3fa82944ce26";
const item = "c38bdfae-f1f4-41d6-b8db-41710928a38b";
const ok = () => vi.fn().mockResolvedValue({ data: null, error: null });

describe("equipes de antes da plataforma (#136)", () => {
  it("adiciona com os textos aparados e o papel da lista", async () => {
    // Arrange
    const rpc = ok();

    // Act
    const result = await addPriorTeam({ rpc }, { teamName: "  Equipe Saúde  ", period: " 2023 ", role: "spokesperson" });

    // Assert
    expect(result).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("add_prior_team", { p_team_name: "Equipe Saúde", p_period: "2023", p_role: "spokesperson" });
  });

  it("recusa antes do banco: nome curto, período vazio, papel fora da lista", async () => {
    const rpc = ok();

    const results = await Promise.all([
      addPriorTeam({ rpc }, { teamName: "A", period: "2023", role: "member" }),
      addPriorTeam({ rpc }, { teamName: "Equipe", period: "  ", role: "member" }),
      addPriorTeam({ rpc }, { teamName: "Equipe", period: "2023", role: "manager" }),
      addPriorTeam({ rpc }, { teamName: "x".repeat(81), period: "2023", role: "member" }),
    ]);

    expect(results.every((r) => !r.ok && r.error === "invalid")).toBe(true);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("traduz os erros do banco: lista cheia, sem permissão e outro erro", async () => {
    const full = vi.fn().mockResolvedValue({ data: null, error: { code: "22023", message: "a lista tem até 5 equipes" } });
    const denied = vi.fn().mockResolvedValue({ data: null, error: { code: "42501", message: "x" } });
    const broken = vi.fn().mockResolvedValue({ data: null, error: { code: "XX000", message: "x" } });
    const input = { teamName: "Equipe Saúde", period: "2023", role: "member" };

    expect(await addPriorTeam({ rpc: full }, input)).toEqual({ ok: false, error: "full" });
    expect(await addPriorTeam({ rpc: denied }, input)).toEqual({ ok: false, error: "not_allowed" });
    expect(await addPriorTeam({ rpc: broken }, input)).toEqual({ ok: false, error: "failed" });
  });

  it("remove só com id válido", async () => {
    const rpc = ok();

    expect(await removePriorTeam({ rpc }, "../x")).toEqual({ ok: false, error: "invalid" });
    expect(await removePriorTeam({ rpc }, item)).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("remove_prior_team", { p_item: item });
  });

  it("lê a lista; formato inesperado ou erro do banco viram exceção (a tela registra e mostra vazio)", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{ id: item, team_name: "Equipe Saúde", period: "2023", role: "coordinator", position: 1 }],
      error: null,
    });
    const odd = vi.fn().mockResolvedValue({ data: [{ id: item, role: "chefe" }], error: null });
    const failing = vi.fn().mockResolvedValue({ data: null, error: { code: "42501" } });

    expect(await readPriorTeams({ rpc }, person)).toEqual([{ id: item, teamName: "Equipe Saúde", period: "2023", role: "coordinator" }]);
    expect(rpc).toHaveBeenCalledWith("prior_teams_list", { p_profile: person });
    await expect(readPriorTeams({ rpc: odd }, person)).rejects.toThrow("prior_teams_read_failed");
    await expect(readPriorTeams({ rpc: failing }, person)).rejects.toThrow("prior_teams_read_failed");
  });
});
