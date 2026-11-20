import { describe, expect, it, vi } from "vitest";
import type { SearchClient } from "../types";
import { searchPeople } from "./search";

function makeClient(rpcImpl: (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>): SearchClient {
  return {
    rpc: vi.fn(rpcImpl),
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(),
        order: vi.fn(),
        then: vi.fn(),
      })),
    })),
  };
}

const validUuid = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";

describe("searchPeople", () => {
  it("entrada inválida não chama o banco", async () => {
    // Arrange
    const rpcMock = vi.fn().mockResolvedValue({ data: [], error: null });
    const client = makeClient(rpcMock);
    const decrypt = vi.fn().mockResolvedValue("Maria");

    // Act
    const result = await searchPeople(client, { skillIds: [] }, decrypt);

    // Assert
    expect(result).toEqual({ ok: false, error: "invalid" });
    expect(rpcMock).not.toHaveBeenCalled();
    expect(decrypt).not.toHaveBeenCalled();
  });

  it("chama rpc com os argumentos certos", async () => {
    // Arrange
    const rpcMock = vi.fn().mockResolvedValue({ data: [], error: null });
    const client = makeClient(rpcMock);
    const decrypt = vi.fn().mockResolvedValue("Maria");

    // Act
    const result = await searchPeople(client, { skillIds: [validUuid], municipalityCode: 3550308 }, decrypt);

    // Assert
    expect(rpcMock).toHaveBeenCalledWith("search_people_by_skill", {
      p_skill_ids: [validUuid],
      p_municipality_code: 3550308,
      p_limit: 50,
    });
    expect(result).toEqual({ ok: true, value: [] });
  });

  it("decifra os nomes", async () => {
    // Arrange
    const rpcMock = vi.fn().mockResolvedValue({
      data: [
        {
          profile_id: validUuid,
          display_name_enc: "enc:123",
          municipality_code: 3550308,
          skill_names: ["Comunicação", "Liderança"],
        },
      ],
      error: null,
    });
    const client = makeClient(rpcMock);
    const decrypt = vi.fn().mockResolvedValue("João Silva");

    // Act
    const result = await searchPeople(client, { skillIds: [validUuid] }, decrypt);

    // Assert
    expect(decrypt).toHaveBeenCalledWith("enc:123", validUuid);
    expect(result).toEqual({
      ok: true,
      value: [
        {
          profileId: validUuid,
          displayName: "João Silva",
          municipalityCode: 3550308,
          skillNames: ["Comunicação", "Liderança"],
        },
      ],
    });
  });

  it("falha no decrypt vira '—'", async () => {
    // Arrange
    const rpcMock = vi.fn().mockResolvedValue({
      data: [
        {
          profile_id: validUuid,
          display_name_enc: "enc:invalid",
          municipality_code: null,
          skill_names: ["Mobilização"],
        },
      ],
      error: null,
    });
    const client = makeClient(rpcMock);
    const decrypt = vi.fn().mockRejectedValue(new Error("cipher error"));

    // Act
    const result = await searchPeople(client, { skillIds: [validUuid] }, decrypt);

    // Assert
    expect(result).toEqual({
      ok: true,
      value: [
        {
          profileId: validUuid,
          displayName: "—",
          municipalityCode: null,
          skillNames: ["Mobilização"],
        },
      ],
    });
  });

  it("erro do rpc → failed", async () => {
    // Arrange
    const rpcMock = vi.fn().mockResolvedValue({ data: null, error: { message: "database error" } });
    const client = makeClient(rpcMock);
    const decrypt = vi.fn().mockResolvedValue("Ana");

    // Act
    const result = await searchPeople(client, { skillIds: [validUuid] }, decrypt);

    // Assert
    expect(result).toEqual({ ok: false, error: "failed" });
    expect(decrypt).not.toHaveBeenCalled();
  });
});
