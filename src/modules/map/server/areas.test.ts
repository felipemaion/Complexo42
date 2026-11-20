import { describe, expect, it, vi } from "vitest";
import { intensity, readAreas } from "./areas";

describe("mapa de onde estão as pessoas (#24)", () => {
  it("separa municípios e distritos; menos de 5 vem como null", async () => {
    // Arrange
    const rpc = vi.fn().mockResolvedValue({
      data: [
        { kind: "municipio", code: 3550308, label: "São Paulo", people: 12 },
        { kind: "municipio", code: 3548708, label: "São Bernardo do Campo", people: null },
        { kind: "distrito", code: null, label: "Sé", people: 6 },
      ],
      error: null,
    });

    // Act
    const areas = await readAreas({ rpc });

    // Assert
    expect(rpc).toHaveBeenCalledWith("members_by_area", {});
    expect(areas.cities.get(3550308)).toEqual({ label: "São Paulo", people: 12 });
    expect(areas.cities.get(3548708)).toEqual({ label: "São Bernardo do Campo", people: null });
    expect(areas.districts).toEqual([{ label: "Sé", people: 6 }]);
  });

  it("intensidade da cor: sem gente 0, '< 5' fraca, o resto proporcional ao maior", () => {
    expect(intensity(undefined, 20)).toBe(0);
    expect(intensity(null, 20)).toBe(0.2);
    expect(intensity(20, 20)).toBe(1);
    expect(intensity(10, 20)).toBeCloseTo(0.6);
  });
});
