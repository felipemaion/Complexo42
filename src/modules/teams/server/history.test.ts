import { describe, expect, it, vi } from "vitest";
import { historyPath, readPersonHistory } from "./history";

const person = "0b7e28b8-07cb-4f9e-a89c-3fa82944ce26";
const team = "c38bdfae-f1f4-41d6-b8db-41710928a38b";
const spoke = "11111111-1111-4111-8111-111111111111";

describe("histórico de equipes da pessoa (#69)", () => {
  it("monta o caminho só com id válido", () => {
    // Arrange / Act / Assert
    expect(historyPath(person)).toBe(`/coordenacao/historico/${person}`);
    expect(historyPath("../x")).toBe("/coordenacao/equipes");
  });

  it("lê o histórico e decifra o nome de cada porta-voz", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{ team_id: team, team_name: "Equipe Saúde", joined_at: "2026-11-01T00:00:00Z", left_at: "2026-11-20T00:00:00Z",
        spokespeople: [{ profile_id: spoke, display_name_enc: "enc" }] }],
      error: null,
    });
    const decrypt = vi.fn(async () => "Bruno Exemplo");

    const rows = await readPersonHistory({ rpc }, person, decrypt);

    expect(rpc).toHaveBeenCalledWith("person_history", { p_profile: person });
    expect(decrypt).toHaveBeenCalledWith("enc", spoke);
    expect(rows).toEqual([{ teamId: team, teamName: "Equipe Saúde", joinedAt: "2026-11-01T00:00:00Z", leftAt: "2026-11-20T00:00:00Z", spokespeople: ["Bruno Exemplo"] }]);
  });
});
