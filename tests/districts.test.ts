// Lista de distritos (config/districts.ts, #12): cada nome cabe no CHECK de `profiles.district`
// (2 a 60 caracteres, sem espaços nas pontas) e não se repete.
import { describe, expect, it } from "vitest";
import { districtsByMunicipality } from "@config/districts";
import { profileLimits } from "@/modules/profiles";

describe("config/districts.ts", () => {
  it("a capital paulista tem os 96 distritos do IBGE", () => {
    expect(districtsByMunicipality[3550308]).toHaveLength(96);
  });

  it("cada nome cabe na coluna e nenhum se repete", () => {
    for (const [code, names] of Object.entries(districtsByMunicipality)) {
      expect(code).toMatch(/^\d{7}$/);
      expect(new Set(names).size).toBe(names.length);
      for (const name of names) {
        expect(name).toBe(name.trim());
        expect(name).toBe(name.normalize("NFC"));
        expect([...name].length).toBeGreaterThanOrEqual(profileLimits.districtMin);
        expect([...name].length).toBeLessThanOrEqual(profileLimits.districtMax);
      }
    }
  });
});
