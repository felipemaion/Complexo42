import { describe, expect, it, vi } from "vitest";
import type { BadgesClient } from "../types";
import { createBadge, grantBadge, grantWorkedWith, readMyBadges } from "./badges";

const scopeUnitId = "0b7e28b8-07cb-4f9e-a89c-3fa82944ce26";
const missionId = "c38bdfae-f1f4-41d6-b8db-41710928a38b";

describe("criar medalha (manual e automática, #36)", () => {
  it("medalha manual continua indo para create_badge", async () => {
    // Arrange
    const rpcMock = vi.fn().mockResolvedValue({ data: "id", error: null });

    // Act
    const result = await createBadge({ rpc: rpcMock }, { scopeUnitId, name: "Melhor roteiro", description: "", icon: "trofeu", rule: "manual" });

    // Assert
    expect(result).toEqual({ ok: true });
    expect(rpcMock).toHaveBeenCalledWith("create_badge", { p_scope_unit: scopeUnitId, p_name: "Melhor roteiro", p_description: "", p_icon: "trofeu" });
  });

  it("medalha por pontos vai para create_auto_badge com o limite", async () => {
    const rpcMock = vi.fn().mockResolvedValue({ data: "id", error: null });

    const result = await createBadge({ rpc: rpcMock }, { scopeUnitId, name: "Cem pontos", description: "", icon: "fogo", rule: "points_threshold", points: "100", missionId: "" });

    expect(result).toEqual({ ok: true });
    expect(rpcMock).toHaveBeenCalledWith("create_auto_badge", {
      p_scope_unit: scopeUnitId, p_name: "Cem pontos", p_description: "", p_icon: "fogo",
      p_rule_type: "points_threshold", p_mission: null, p_points: 100,
    });
  });

  it("medalha por missão vai para create_auto_badge com a missão", async () => {
    const rpcMock = vi.fn().mockResolvedValue({ data: "id", error: null });

    await createBadge({ rpc: rpcMock }, { scopeUnitId, name: "Missão cumprida", description: "", icon: "trofeu", rule: "mission_completed", points: "", missionId });

    expect(rpcMock).toHaveBeenCalledWith("create_auto_badge", expect.objectContaining({ p_rule_type: "mission_completed", p_mission: missionId, p_points: null }));
  });

  it("medalha de evento ou marco (#71) vai para create_special_badge", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: "id", error: null });

    const result = await createBadge({ rpc }, { scopeUnitId, name: "10 mil views", description: "", icon: "camera", rule: "milestone", points: "", missionId: "" });

    expect(result).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("create_special_badge", { p_scope_unit: scopeUnitId, p_name: "10 mil views", p_description: "", p_icon: "camera", p_rule_type: "milestone" });
  });

  it("medalha por missão sem a missão escolhida é recusada sem ir ao banco", async () => {
    const rpcMock = vi.fn();

    const result = await createBadge({ rpc: rpcMock }, { scopeUnitId, name: "Sem missão", description: "", icon: "trofeu", rule: "mission_completed", points: "", missionId: "" });

    expect(result).toEqual({ ok: false, error: "invalid" });
    expect(rpcMock).not.toHaveBeenCalled();
  });
});

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

describe('medalha "trabalhou com" (#71)', () => {
  const owner = "0b7e28b8-07cb-4f9e-a89c-3fa82944ce26";
  const award = {
    award_id: "5b5c3ff9-b3a1-43e9-b5fe-68bce75c7438",
    name: "Trabalhou com",
    description: "",
    icon: "coracao",
    reason: "Trabalhou na equipe",
    awarded_at: "2026-11-22T10:00:00.000Z",
    owner_id: owner,
    owner_name_enc: "v1.nome-cifrado",
  };

  it("junta o nome do porta-voz, aberto com o contexto dele", async () => {
    // Arrange
    const rpc = vi.fn().mockResolvedValue({ data: [award], error: null });
    const decrypt = vi.fn(async () => "Gabriela Teste");

    // Act
    const [first] = await readMyBadges({ rpc }, "c38bdfae-f1f4-41d6-b8db-41710928a38b", decrypt);

    // Assert
    expect(decrypt).toHaveBeenCalledWith("v1.nome-cifrado", owner);
    expect(first?.name).toBe("Trabalhou com Gabriela Teste");
  });

  it("se o nome não abre (ou não veio), fica só \"Trabalhou com\"", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [award, { ...award, owner_name_enc: null }], error: null });
    const decrypt = vi.fn(async () => {
      throw new Error("chave errada");
    });

    const awards = await readMyBadges({ rpc }, "c38bdfae-f1f4-41d6-b8db-41710928a38b", decrypt);

    expect(awards.map((a) => a.name)).toEqual(["Trabalhou com", "Trabalhou com"]);
    expect(decrypt).toHaveBeenCalledTimes(1);
  });

  it("o porta-voz dá a medalha só com id válido; erros do banco viram códigos da tela", async () => {
    const ok = vi.fn().mockResolvedValue({ data: "id", error: null });
    const denied = vi.fn().mockResolvedValue({ data: null, error: { code: "42501" } });
    const twice = vi.fn().mockResolvedValue({ data: null, error: { code: "23505" } });

    expect(await grantWorkedWith({ rpc: ok }, { profileId: "../x" })).toEqual({ ok: false, error: "invalid" });
    expect(await grantWorkedWith({ rpc: ok }, { profileId: owner })).toEqual({ ok: true });
    expect(ok).toHaveBeenCalledWith("grant_worked_with", { p_profile: owner });
    expect(await grantWorkedWith({ rpc: denied }, { profileId: owner })).toEqual({ ok: false, error: "not_allowed" });
    expect(await grantWorkedWith({ rpc: twice }, { profileId: owner })).toEqual({ ok: false, error: "already_has" });
  });
});
