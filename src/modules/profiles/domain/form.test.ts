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
      keepSocialLinks: true,
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
    const all = ["displayName", "whatsapp", "municipalityCode", "district", "socialLinks"];
    expect(fieldsOf(null)).toEqual(all);
    expect(fieldsOf({ ...valid, displayName: 42 })).toEqual(all);
    expect(fieldsOf({ ...valid, displayName: "a".repeat(201) })).toEqual(all);
    // Caixas de link demais num envio não vêm do formulário: tudo recusado.
    expect(fieldsOf({ ...valid, socialLinks: Array.from({ length: 21 }, () => "") })).toEqual(all);
    expect(fieldsOf({ ...valid, whatsapp: `${"1".repeat(40)}` })).toEqual(["whatsapp"]);
  });
});

describe("parseProfileForm: redes sociais (#17)", () => {
  const parse = (socialLinks: unknown) => parseProfileForm({ ...valid, socialLinks }, districtsFor);

  it("normaliza os links (https:// por padrão), ignora caixas vazias e marca que vieram no envio", () => {
    const result = parse(["instagram.com/ana", "", "  https://WWW.TikTok.com/@ana  "]);
    expect(result.ok && result.contact.socialLinks).toEqual(["https://instagram.com/ana", "https://www.tiktok.com/@ana"]);
    expect(result.ok && result.keepSocialLinks).toBe(false);
  });

  it("sem o campo no envio: manter os guardados; com o campo vazio: a pessoa tirou todos", () => {
    const absent = parseProfileForm(valid, districtsFor);
    expect(absent.ok && absent.keepSocialLinks).toBe(true);
    const cleared = parse([""]);
    expect(cleared.ok && cleared.keepSocialLinks).toBe(false);
    expect(cleared.ok && cleared.contact.socialLinks).toEqual([]);
  });

  it("javascript:, data:, http:, usuário/senha e texto com <script>: recusados, com a posição de cada caixa", () => {
    const result = parse([
      "https://instagram.com/ana",
      "javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "http://instagram.com/ana",
      "https://instagram.com@golpe.example/ana",
      "<script>alert(1)</script>",
    ]);
    expect(result).toEqual({ ok: false, fields: ["socialLinks"], badLinks: [1, 2, 3, 4, 5] });
    // Nunca devolve o valor (R11).
    expect(JSON.stringify(result)).not.toContain("alert");
  });

  it("repetido depois de normalizar é recusado na segunda caixa", () => {
    expect(parse(["instagram.com/ana", "https://instagram.com/ana"])).toEqual({
      ok: false,
      fields: ["socialLinks"],
      badLinks: [1],
    });
  });

  it("até 5 links; o 6º é recusado", () => {
    const five = Array.from({ length: 5 }, (_, i) => `https://rede.example/p${i}`);
    expect(parse(five).ok).toBe(true);
    expect(parse([...five, "https://rede.example/p5"])).toEqual({ ok: false, fields: ["socialLinks"] });
  });

  it("link longo demais é recusado, nunca cortado", () => {
    expect(parse([`https://rede.example/${"a".repeat(300)}`])).toEqual({ ok: false, fields: ["socialLinks"], badLinks: [0] });
    expect(fieldsOf({ ...valid, socialLinks: ["a".repeat(5000)] })).toContain("socialLinks");
  });

  it("um link errado não esconde os outros erros", () => {
    expect(fieldsOf({ ...valid, displayName: "A", socialLinks: ["javascript:alert(1)"] })).toEqual(["displayName", "socialLinks"]);
  });
});
