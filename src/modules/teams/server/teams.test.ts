import { describe, expect, it } from "vitest";
import type { TeamsClient } from "../types";
import {
  createTeam,
  readTeamMembers,
  setTeamLead,
} from "./teams";

type RecordedRpcCall = {
  readonly fn: string;
  readonly args?: Record<string, unknown>;
};

function createMockClient(options?: {
  readonly data?: unknown;
  readonly error?: unknown;
}): {
  readonly client: TeamsClient;
  readonly calls: readonly RecordedRpcCall[];
} {
  const recordedCalls: RecordedRpcCall[] = [];
  const client: TeamsClient = {
    rpc: async (fn: string, args?: Record<string, unknown>) => {
      recordedCalls.push({ fn, args });
      return {
        data: options?.data ?? null,
        error: options?.error ?? null,
      };
    },
  };

  return {
    client,
    get calls() {
      return recordedCalls;
    },
  };
}

describe("módulo de equipes no servidor", () => {
  it("não chama o banco quando a entrada é inválida", async () => {
    // Arrange
    const { client, calls } = createMockClient();
    const inputInvalido = { parentId: "não-é-guid", name: "" };

    // Act
    const resultado = await createTeam(client, inputInvalido);

    // Assert
    expect(resultado).toEqual({ ok: false, error: "invalid" });
    expect(calls).toHaveLength(0);
  });

  it("chama createTeam enviando p_parent e p_name com espaços aparados", async () => {
    // Arrange
    const { client, calls } = createMockClient({ data: "88888888-8888-4888-8888-888888888888" });
    const input = {
      parentId: "11111111-1111-4111-8111-111111111111",
      name: "  Equipe Alfa  ",
    };

    // Act
    const resultado = await createTeam(client, input);

    // Assert
    expect(resultado).toEqual({ ok: true });
    expect(calls).toEqual([
      {
        fn: "create_team",
        args: {
          p_parent: "11111111-1111-4111-8111-111111111111",
          p_name: "Equipe Alfa",
        },
      },
    ]);
  });

  it("mapeia erro de banco 42501 para not_allowed", async () => {
    // Arrange
    const { client, calls } = createMockClient({
      error: { code: "42501", message: "insufficient_privilege" },
    });
    const input = {
      parentId: "11111111-1111-4111-8111-111111111111",
      name: "Equipe Beta",
    };

    // Act
    const resultado = await createTeam(client, input);

    // Assert
    expect(resultado).toEqual({ ok: false, error: "not_allowed" });
    expect(calls).toHaveLength(1);
  });

  it("decifra os nomes dos membros e substitui por travessão quando falhar", async () => {
    // Arrange
    const teamId = "22222222-2222-4222-8222-222222222222";
    const { client } = createMockClient({
      data: [
        {
          profile_id: "33333333-3333-4333-8333-333333333333",
          display_name_enc: "enc:maria",
          is_lead: true,
        },
        {
          profile_id: "44444444-4444-4444-8444-444444444444",
          display_name_enc: "enc:corrompido",
          is_lead: false,
        },
      ],
    });

    const mockDecrypt = async (enc: string): Promise<string> => {
      if (enc === "enc:corrompido") throw new Error("chave_invalida");
      return "Maria Silva";
    };

    // Act
    const membros = await readTeamMembers(client, teamId, mockDecrypt);

    // Assert
    expect(membros).toEqual([
      {
        profileId: "33333333-3333-4333-8333-333333333333",
        displayName: "Maria Silva",
        isLead: true,
      },
      {
        profileId: "44444444-4444-4444-8444-444444444444",
        displayName: "—",
        isLead: false,
      },
    ]);
  });

  it("chama setTeamLead enviando p_team e p_profile corretamente", async () => {
    // Arrange
    const { client, calls } = createMockClient({ data: null });
    const input = {
      teamId: "22222222-2222-4222-8222-222222222222",
      profileId: "33333333-3333-4333-8333-333333333333",
    };

    // Act
    const resultado = await setTeamLead(client, input);

    // Assert
    expect(resultado).toEqual({ ok: true });
    expect(calls).toEqual([
      {
        fn: "set_team_lead",
        args: {
          p_team: "22222222-2222-4222-8222-222222222222",
          p_profile: "33333333-3333-4333-8333-333333333333",
        },
      },
    ]);
  });
});
