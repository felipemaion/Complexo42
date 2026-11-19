import { describe, expect, it } from "vitest";
import { consentNotYetGiven, parseProfileForm, type DistrictCatalog } from "./form";

const SP = 3550308;
const districtsFor: DistrictCatalog = (code) => (code === SP ? ["Sé", "Vila Mariana"] : undefined);
const valid = { displayName: "  Ana   Souza ", whatsapp: "(11) 91234-5678", municipalityCode: String(SP), district: "Sé" };

function fieldsOf(raw: unknown): string[] {
  const result = parseProfileForm(raw, districtsFor);
  if (result.ok) throw new Error("esperava entrada inválida");
  return result.fields;
}

describe("parseProfileForm", () => {
  it("formulário válido vira os dados do perfil e do contato (E.164)", () => {
    expect(parseProfileForm(valid, districtsFor)).toEqual({
      ok: true,
      profile: { displayName: "Ana Souza", municipalityCode: SP, district: "Sé", consentVersion: consentNotYetGiven },
      contact: { whatsapp: "+5511912345678", socialLinks: [] },
    });
  });

  it("distrito é opcional na capital", () => {
    const result = parseProfileForm({ ...valid, district: "" }, districtsFor);
    expect(result.ok && result.profile.district).toBeNull();
  });

  it("distrito fora da lista é recusado na capital", () => {
    expect(fieldsOf({ ...valid, district: "Centro" })).toEqual(["district"]);
    expect(fieldsOf({ ...valid, district: "sé" })).toEqual(["district"]);
  });

  it("fora da capital, o distrito enviado é descartado", () => {
    const result = parseProfileForm({ ...valid, municipalityCode: "3518800", district: "Sé" }, districtsFor);
    expect(result.ok && result.profile).toMatchObject({ municipalityCode: 3518800, district: null });
  });

  it("cada campo inválido aparece pelo nome, sem o valor (R11)", () => {
    expect(fieldsOf({ ...valid, displayName: "A" })).toEqual(["displayName"]);
    expect(fieldsOf({ ...valid, displayName: "a\u0007b" })).toEqual(["displayName"]);
    expect(fieldsOf({ ...valid, whatsapp: "(11) 1234-5678" })).toEqual(["whatsapp"]);
    expect(fieldsOf({ ...valid, municipalityCode: "" })).toEqual(["municipalityCode"]);
    expect(fieldsOf({ ...valid, municipalityCode: "355030" })).toEqual(["municipalityCode"]);
    expect(fieldsOf({ ...valid, municipalityCode: "3550308; drop" })).toEqual(["municipalityCode"]);
    expect(fieldsOf({ displayName: "", whatsapp: "", municipalityCode: "" })).toEqual([
      "displayName",
      "whatsapp",
      "municipalityCode",
    ]);
    const result = parseProfileForm({ ...valid, whatsapp: "(11) 1234-5678" }, districtsFor);
    expect(JSON.stringify(result)).not.toContain("1234");
  });

  it("entrada que não é texto, ou longa demais, é recusada", () => {
    expect(fieldsOf(null)).toEqual(["displayName", "whatsapp", "municipalityCode", "district"]);
    expect(fieldsOf({ ...valid, displayName: 42 })).toEqual(["displayName", "whatsapp", "municipalityCode", "district"]);
    expect(fieldsOf({ ...valid, displayName: "a".repeat(201) })).toEqual(["displayName", "whatsapp", "municipalityCode", "district"]);
    expect(fieldsOf({ ...valid, whatsapp: `${"1".repeat(40)}` })).toEqual(["whatsapp"]);
  });
});
