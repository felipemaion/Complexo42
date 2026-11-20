import { describe, expect, it, vi } from "vitest";
import type { BadgesClient } from "../types";
import { grantBadge, readMyBadges } from "./badges";

describe("badges server module", () => {
  it("não chama o banco quando a entrada é inválida", async () => {
    // Arrange
    const rpcMock = vi.fn();
    const fakeClient: BadgesClient = { rpc: rpcMock };
    const invalidInput = {
      badgeId: "not-a-guid",
      profileId: "c38bdfae-f1f4-41d6-b8db-41710928a38b",
      reason: "ok",
    };

    // Act
    const result = await grantBadge(fakeClient, invalidInput);

    // Assert
    expect(rpcMock).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: false, error: "invalid" });
  });

  it("chama grant_badge com p_badge, p_profile e p_reason aparado", async () => {
    // Arrange
    const rpcMock = vi.fn().mockResolvedValue({ data: "fake-uuid", error: null });
    const fakeClient: BadgesClient = { rpc: rpcMock };
    const validInput = {
      badgeId: "0b7e28b8-07cb-4f9e-a89c-3fa82944ce26",
      profileId: "c38bdfae-f1f4-41d6-b8db-41710928a38b",
      reason: "  Excelente contribuição técnica  ",
    };

    // Act
    const result = await grantBadge(fakeClient, validInput);

    // Assert
    expect(rpcMock).toHaveBeenCalledWith("grant_badge", {
      p_badge: "0b7e28b8-07cb-4f9e-a89c-3fa82944ce26",
      p_profile: "c38bdfae-f1f4-41d6-b8db-41710928a38b",
      p_reason: "Excelente contribuição técnica",
    });
    expect(result).toEqual({ ok: true });
  });

  it("mapeia erro de banco 23505 para already_has", async () => {
    // Arrange
    const rpcMock = vi.fn().mockResolvedValue({
      data: null,
      error: { code: "23505", message: "unique violation" },
    });
    const fakeClient: BadgesClient = { rpc: rpcMock };
    const validInput = {
      badgeId: "0b7e28b8-07cb-4f9e-a89c-3fa82944ce26",
      profileId: "c38bdfae-f1f4-41d6-b8db-41710928a38b",
      reason: "Excelente dedicação e consistência",
    };

    // Act
    const result = await grantBadge(fakeClient, validInput);

    // Assert
    expect(result).toEqual({ ok: false, error: "already_has" });
  });

  it("converte awarded_at para awardedAt em readMyBadges", async () => {
    // Arrange
    const fakeAward = {
      award_id: "5b5c3ff9-b3a1-43e9-b5fe-68bce75c7438",
      name: "Estrela do Mês",
      description: "Destaque por colaboração",
      icon: "estrela",
      reason: "Ajudou toda a equipe com as entregas",
      awarded_at: "2026-11-20T10:00:00.000Z",
    };
    const rpcMock = vi.fn().mockResolvedValue({
      data: [fakeAward],
      error: null,
    });
    const fakeClient: BadgesClient = { rpc: rpcMock };

    // Act
    const awards = await readMyBadges(fakeClient, "c38bdfae-f1f4-41d6-b8db-41710928a38b");

    // Assert
    expect(rpcMock).toHaveBeenCalledWith("profile_badge_list", {
      p_profile: "c38bdfae-f1f4-41d6-b8db-41710928a38b",
    });
    expect(awards).toEqual([
      {
        awardId: "5b5c3ff9-b3a1-43e9-b5fe-68bce75c7438",
        name: "Estrela do Mês",
        description: "Destaque por colaboração",
        icon: "estrela",
        reason: "Ajudou toda a equipe com as entregas",
        awardedAt: "2026-11-20T10:00:00.000Z",
      },
    ]);
  });
});
