import { describe, expect, it } from "vitest";
import { houseIdFromUnitSlug, houseUnitSlug } from "./link";

describe("casa da config ↔ unidade", () => {
  it("o slug da unidade é o id com _ no lugar de -", () => {
    expect(houseUnitSlug("casa-de-teste-1")).toBe("casa_de_teste_1");
    expect(houseUnitSlug("a")).toBe("a");
  });

  it("acha a casa pelo slug da unidade, ou null", () => {
    const ids = ["casa-um", "casa-dois"];
    expect(houseIdFromUnitSlug("casa_dois", ids)).toBe("casa-dois");
    expect(houseIdFromUnitSlug("casa-dois", ids)).toBeNull();
    expect(houseIdFromUnitSlug("equipe_1", ids)).toBeNull();
  });
});
