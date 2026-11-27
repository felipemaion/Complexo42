import { describe, expect, it, vi } from "vitest";
import type { CollabClient } from "../types";
import { postMessage, readDashboard, submitEvaluation } from "./collab";

describe("módulo collab (testes unitários)", () => {
  it("postMessage com entrada inválida não deve chamar o banco", async () => {
    // Arrange
    const rpcMock = vi.fn();
    const fakeClient: CollabClient = { rpc: rpcMock };
    const fakeEncrypt = vi.fn();

    // Act
    const result = await postMessage(
      fakeClient,
      { teamId: "not-a-valid-uuid", body: "" },
      fakeEncrypt,
    );

    // Assert
    expect(result).toEqual({ ok: false, error: "invalid" });
    expect(fakeEncrypt).not.toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("postMessage cifra antes de enviar e passa ao rpc o valor cifrado", async () => {
    // Arrange
    const teamId = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";
    const rawBody = "Olá equipe!";
    const encryptedText = "enc:cipher_text_123";

    const rpcMock = vi.fn().mockResolvedValue({ data: "msg-id", error: null });
    const fakeClient: CollabClient = { rpc: rpcMock };
    const encryptMock = vi.fn().mockResolvedValue(encryptedText);

    // Act
    const result = await postMessage(fakeClient, { teamId, body: rawBody }, encryptMock);

    // Assert
    expect(encryptMock).toHaveBeenCalledWith(rawBody, teamId);
    expect(rpcMock).toHaveBeenCalledWith("post_team_message", {
      p_team: teamId,
      p_body_enc: encryptedText,
    });
    expect(result).toEqual({ ok: true });
  });

  it("postMessage mapeia erro C7614 para too_many", async () => {
    // Arrange
    const teamId = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";
    const rpcMock = vi.fn().mockResolvedValue({
      data: null,
      error: { code: "C7614", message: "rate limit exceeded" },
    });
    const fakeClient: CollabClient = { rpc: rpcMock };
    const fakeEncrypt = vi.fn().mockResolvedValue("enc:text");

    // Act
    const result = await postMessage(fakeClient, { teamId, body: "Teste" }, fakeEncrypt);

    // Assert
    expect(result).toEqual({ ok: false, error: "too_many" });
  });

  it("submitEvaluation envia p_axis team e a data recebida", async () => {
    // Arrange
    const profileId = "b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a22";
    const today = "2026-11-20";
    const rpcMock = vi.fn().mockResolvedValue({ data: "eval-id", error: null });
    const fakeClient: CollabClient = { rpc: rpcMock };
    const encryptMock = vi.fn().mockImplementation((val: string) => Promise.resolve(`enc:${val}`));

    // Act
    const result = await submitEvaluation(
      fakeClient,
      { profileId, grade: "ouro", note: "Excelente trabalho" },
      encryptMock,
      today,
    );

    // Assert
    expect(result).toEqual({ ok: true });
    expect(rpcMock).toHaveBeenCalledWith("submit_evaluation", {
      p_profile: profileId,
      p_axis: "team",
      p_grade_enc: "enc:ouro",
      p_note_enc: "enc:Excelente trabalho",
      p_cycle_ends_on: today,
    });
  });

  it("readDashboard converte os campos do banco corretamente", async () => {
    // Arrange
    const teamId = "c2eebc99-9c0b-4ef8-bb6d-6bb9bd380a33";
    const rpcMock = vi.fn().mockResolvedValue({
      data: [
        {
          team_id: teamId,
          team_name: "Equipe Alfa",
          member_count: 5,
          active_runs: 2,
          completed_runs: 10,
          team_points: 1500,
        },
      ],
      error: null,
    });
    const fakeClient: CollabClient = { rpc: rpcMock };

    // Act
    const rows = await readDashboard(fakeClient);

    // Assert
    expect(rows).toEqual([
      {
        teamId,
        teamName: "Equipe Alfa",
        memberCount: 5,
        activeRuns: 2,
        completedRuns: 10,
        teamPoints: 1500,
      },
    ]);
  });
});
