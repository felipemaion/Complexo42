import { describe, expect, it } from "vitest";
import { consentNotYetGiven, parseProfileForm } from "./form";

const SP = 3550308;
const SE_DISTRICT = 355030878;
const valid = { displayName: "  Ana   Souza ", whatsapp: "(11) 91234-5678", municipalityCode: String(SP), district: String(SE_DISTRICT), neighborhood: " Vila  Exemplo " };

function fieldsOf(raw: unknown): string[] {
  const result = parseProfileForm(raw);
  if (result.ok) throw new Error("esperava entrada inválida");
  return result.fields;
}

describe("parseProfileForm", () => {
  it("formulário válido vira os dados do perfil e do contato (E.164)", () => {
    expect(parseProfileForm(valid)).toEqual({
      ok: true,
      profile: { displayName: "Ana Souza", municipalityCode: SP, districtCode: SE_DISTRICT, neighborhood: "Vila Exemplo", consentVersion: consentNotYetGiven },
      contact: { whatsapp: "+5511912345678", socialLinks: [] },
      background: { educationLevel: null, educationDetail: null, occupation: null },
      keepSocialLinks: true,
      keepNeighborhood: false,
      keepBackground: true,
    });
  });

  describe("formação e atividade (#304)", () => {
    const filled = { ...valid, educationLevel: "college_complete", educationDetail: " Engenharia  Civil ", occupation: " Professora " };

    it("envio com os campos: validados, normalizados, e o servidor grava (não mantém)", () => {
      const result = parseProfileForm(filled);
      expect(result).toMatchObject({
        ok: true,
        background: { educationLevel: "college_complete", educationDetail: "Engenharia Civil", occupation: "Professora" },
        keepBackground: false,
      });
    });

    it("enviados em branco: apaga de propósito (null, sem manter)", () => {
      expect(parseProfileForm({ ...valid, educationLevel: "", educationDetail: "", occupation: "  " })).toMatchObject({
        ok: true,
        background: { educationLevel: null, educationDetail: null, occupation: null },
        keepBackground: false,
      });
    });

    it("sem os campos (formulário antigo): mantém o guardado", () => {
      expect(parseProfileForm(valid)).toMatchObject({ ok: true, keepBackground: true });
    });

    it("cada campo inválido aparece pelo nome", () => {
      expect(fieldsOf({ ...filled, educationLevel: "doutorado" })).toEqual(["educationLevel"]);
      expect(fieldsOf({ ...filled, educationDetail: "x" })).toEqual(["educationDetail"]);
      expect(fieldsOf({ ...filled, occupation: "a".repeat(81) })).toEqual(["occupation"]);
    });
  });

  it("distrito é opcional", () => {
    const result = parseProfileForm({ ...valid, district: "" });
    expect(result.ok && result.profile.districtCode).toBeNull();
  });

  it("bairro é opcional e vai normalizado", () => {
    const blank = parseProfileForm({ ...valid, neighborhood: "  " });
    expect(blank.ok && blank.profile.neighborhood).toBeNull();
    const curly = parseProfileForm({ ...valid, neighborhood: "Jardim d’Abril" });
    expect(curly.ok && curly.profile.neighborhood).toBe("Jardim d'Abril");
  });

  it("sem o campo do bairro no envio (formulário antigo), mantém o guardado; vazio enviado apaga", () => {
    const withoutNeighborhood = { ...valid, neighborhood: undefined };
    const kept = parseProfileForm(withoutNeighborhood);
    expect(kept.ok && [kept.keepNeighborhood, kept.profile.neighborhood]).toEqual([true, null]);
    const cleared = parseProfileForm({ ...valid, neighborhood: "" });
    expect(cleared.ok && [cleared.keepNeighborhood, cleared.profile.neighborhood]).toEqual([false, null]);
  });

  it("bairro com rua, número, símbolo ou fora de 2 a 60 caracteres é recusado", () => {
    for (const bad of ["V", "x".repeat(61), "Rua A, 12", "Vila <b>", "-Vila", "Vila\u0007"]) {
      expect(fieldsOf({ ...valid, neighborhood: bad })).toEqual(["neighborhood"]);
    }
    expect(parseProfileForm({ ...valid, neighborhood: "x".repeat(60) }).ok).toBe(true);
  });

  it("distrito que não é um código IBGE de 9 dígitos é recusado", () => {
    expect(fieldsOf({ ...valid, district: "Sé" })).toEqual(["district"]);
    expect(fieldsOf({ ...valid, district: "35503080" })).toEqual(["district"]);
    expect(fieldsOf({ ...valid, district: "355030878; drop" })).toEqual(["district"]);
  });

  it("cada campo inválido aparece pelo nome, sem o valor (R11)", () => {
    expect(fieldsOf({ ...valid, displayName: "A" })).toEqual(["displayName"]);
    // #312: quem já está cadastrado com uma palavra só vê o formulário com ela e precisa completar.
    expect(fieldsOf({ ...valid, displayName: "Maria" })).toEqual(["displayName"]);
    expect(fieldsOf({ ...valid, displayName: "a b" })).toEqual(["displayName"]);
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
    const result = parseProfileForm({ ...valid, whatsapp: "(11) 1234-5678" });
    expect(JSON.stringify(result)).not.toContain("1234");
  });

  it("entrada que não é texto, ou longa demais, é recusada", () => {
    const all = ["displayName", "whatsapp", "municipalityCode", "district", "neighborhood", "socialLinks", "educationLevel", "educationDetail", "occupation"];
    expect(fieldsOf(null)).toEqual(all);
    expect(fieldsOf({ ...valid, displayName: 42 })).toEqual(all);
    expect(fieldsOf({ ...valid, displayName: "a".repeat(201) })).toEqual(all);
    // Caixas de link demais num envio não vêm do formulário: tudo recusado.
    expect(fieldsOf({ ...valid, socialLinks: Array.from({ length: 21 }, () => "") })).toEqual(all);
    expect(fieldsOf({ ...valid, whatsapp: `${"1".repeat(40)}` })).toEqual(["whatsapp"]);
  });
});

describe("parseProfileForm: redes sociais (#17)", () => {
  const parse = (socialLinks: unknown) => parseProfileForm({ ...valid, socialLinks });

  it("normaliza os links (https:// por padrão), ignora caixas vazias e marca que vieram no envio", () => {
    const result = parse(["instagram.com/ana", "", "  https://WWW.TikTok.com/@ana  "]);
    expect(result.ok && result.contact.socialLinks).toEqual(["https://instagram.com/ana", "https://www.tiktok.com/@ana"]);
    expect(result.ok && result.keepSocialLinks).toBe(false);
  });

  it("sem o campo no envio: manter os guardados; com o campo vazio: a pessoa tirou todos", () => {
    const absent = parseProfileForm(valid);
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
