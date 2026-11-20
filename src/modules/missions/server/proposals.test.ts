import { describe, expect, it, vi } from "vitest";
import { decideProposal, proposeMission, readPendingProposals } from "./proposals";

const CATS = ["acao", "evento"];
const missionId = "0b7e28b8-07cb-4f9e-a89c-3fa82944ce26";
const scope = "c38bdfae-f1f4-41d6-b8db-41710928a38b";

describe("propostas de missão (#57)", () => {
  it("propõe com as etapas no formato do banco", async () => {
    // Arrange
    const rpc = vi.fn().mockResolvedValue({ data: missionId, error: null });

    // Act
    const result = await proposeMission({ rpc }, {
      title: "Mutirão da praça", description: "", category: "acao",
      steps: [{ title: "Marcar o dia", points: "10", evidenceType: "text" }],
    }, CATS);

    // Assert
    expect(result).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("propose_mission", {
      p_title: "Mutirão da praça", p_description: "", p_category: "acao",
      p_steps: [{ title: "Marcar o dia", points: 10, evidence_type: "text" }],
    });
  });

  it("categoria fora da lista e limite de propostas abertas viram erros conhecidos", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { code: "C7614" } });
    const steps = [{ title: "Fazer", points: "10", evidenceType: "none" }];

    expect(await proposeMission({ rpc }, { title: "Algo bom", description: "", category: "xx", steps }, CATS)).toEqual({ ok: false, error: "invalid" });
    expect(await proposeMission({ rpc }, { title: "Algo bom", description: "", category: "acao", steps }, CATS)).toEqual({ ok: false, error: "too_many" });
  });

  it("aprovar manda escopo e pontos; recusar manda só a justificativa", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });

    await decideProposal({ rpc }, { missionId, decision: "approve", scopeUnitId: scope, points: ["20", "60"], note: "" });
    await decideProposal({ rpc }, { missionId, decision: "reject", scopeUnitId: "", points: [], note: "Escola em reforma." });

    expect(rpc).toHaveBeenNthCalledWith(1, "decide_proposal", { p_mission: missionId, p_approve: true, p_scope_unit: scope, p_points: [20, 60], p_note: null });
    expect(rpc).toHaveBeenNthCalledWith(2, "decide_proposal", { p_mission: missionId, p_approve: false, p_scope_unit: null, p_points: null, p_note: "Escola em reforma." });
  });

  it("lê as propostas pendentes com as etapas", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{ id: missionId, title: "Mutirão", description: "", category: "acao", team_id: scope, team_name: "Equipe X", parent_id: scope,
        steps: [{ position: 1, title: "Marcar", points: 10, evidence_type: "text" }], created_at: "2026-11-20T10:00:00Z" }],
      error: null,
    });

    const list = await readPendingProposals({ rpc });

    expect(list[0]).toMatchObject({ id: missionId, teamName: "Equipe X", steps: [{ position: 1, title: "Marcar", points: 10 }] });
  });
});
