import { describe, expect, it, vi } from "vitest";
import { grantRole, readRolesInScope, revokeRole } from "./roles";

const person = "0b7e28b8-07cb-4f9e-a89c-3fa82944ce26";
const unit = "c38bdfae-f1f4-41d6-b8db-41710928a38b";
const assignment = "11111111-1111-4111-8111-111111111111";

describe("delegar papéis (#22)", () => {
  it("concede só os papéis da tela; técnico nem vai ao banco", async () => {
    // Arrange
    const rpc = vi.fn().mockResolvedValue({ data: assignment, error: null });

    // Act
    const ok = await grantRole({ rpc }, { profileId: person, role: "spokesperson", unitId: unit });
    const tech = await grantRole({ rpc }, { profileId: person, role: "tech_admin", unitId: unit });

    // Assert
    expect(ok).toEqual({ ok: true });
    expect(tech).toEqual({ ok: false, error: "invalid" });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("grant_role", { p_profile: person, p_role: "spokesperson", p_unit: unit });
  });

  it("papel repetido e permissão negada viram erros conhecidos", async () => {
    const dup = vi.fn().mockResolvedValue({ data: null, error: { code: "23505" } });
    const denied = vi.fn().mockResolvedValue({ data: null, error: { code: "42501" } });

    expect(await grantRole({ rpc: dup }, { profileId: person, role: "monitor", unitId: unit })).toEqual({ ok: false, error: "already" });
    expect(await revokeRole({ rpc: denied }, assignment)).toEqual({ ok: false, error: "not_allowed" });
  });

  it("lê os papéis do escopo decifrando o nome com o contexto do perfil", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{ id: assignment, profile_id: person, display_name_enc: "enc", role: "monitor", unit_id: unit, unit_name: "Equipe Saúde", granted_at: "2026-11-20T10:00:00Z" }],
      error: null,
    });
    const decrypt = vi.fn(async () => "Ana Exemplo");

    const rows = await readRolesInScope({ rpc }, decrypt);

    expect(decrypt).toHaveBeenCalledWith("enc", person);
    expect(rows).toEqual([{ id: assignment, profileId: person, displayName: "Ana Exemplo", role: "monitor", unitId: unit, unitName: "Equipe Saúde" }]);
  });
});
