import { describe, expect, it } from "vitest";
import { ProfileInputError, educationLevels, parseProfileBackgroundInput, parseProfileContactInput, parseProfileInput, profileLimits, serializeSocialLinks } from "./schema";

const profile = { displayName: "Ana Souza", municipalityCode: 3550308, consentVersion: "v1" };
const contact = { whatsapp: "+5511999998888" };

function fieldsOf(parse: () => unknown): string[] {
  try {
    parse();
  } catch (error) {
    expect(error).toBeInstanceOf(ProfileInputError);
    return (error as ProfileInputError).fields;
  }
  throw new Error("esperava ProfileInputError");
}

describe("parseProfileInput", () => {
  it("aceita um perfil válido e normaliza espaços do nome", () => {
    const parsed = parseProfileInput({ ...profile, displayName: "  Ana   Souza ", districtCode: 355030878 });
    expect(parsed).toEqual({ displayName: "Ana Souza", municipalityCode: 3550308, districtCode: 355030878, neighborhood: null, consentVersion: "v1" });
  });

  it("nome completo (issue #312): exige nome e sobrenome de verdade", () => {
    for (const displayName of ["Ana Souza", "Ana Lu", "Maria da Silva", "D\u2019Ávila Souza", "José-Carlos Souza", "Ana\u00a0Souza", "Ana\u200b Souza"]) {
      expect(() => parseProfileInput({ ...profile, displayName })).not.toThrow();
    }
    expect(parseProfileInput({ ...profile, displayName: "Ana\u00a0 Souza\u200b" }).displayName).toBe("Ana Souza");
    for (const displayName of ["Ana", "  Ana  ", "Ana-Maria", "a b", "1 2", "- -", "😀 😀", "Ana \u200b"]) {
      expect(fieldsOf(() => parseProfileInput({ ...profile, displayName }))).toEqual(["displayName"]);
    }
  });

  it("distrito é opcional", () => {
    expect(parseProfileInput(profile).districtCode).toBeNull();
  });

  it("nome com 2 e com 80 caracteres passa; com 1 e com 81 não", () => {
    expect(parseProfileInput({ ...profile, displayName: "Bo Li" }).displayName).toBe("Bo Li");
    expect(parseProfileInput({ ...profile, displayName: `Ana ${"é".repeat(76)}` }).displayName).toHaveLength(80);
    expect(fieldsOf(() => parseProfileInput({ ...profile, displayName: "A" }))).toEqual(["displayName"]);
    expect(fieldsOf(() => parseProfileInput({ ...profile, displayName: "a".repeat(81) }))).toEqual(["displayName"]);
  });

  it("conta caracteres, não unidades UTF-16 (letra fora do plano básico conta 1)", () => {
    // 𝐀 (U+1D400) é letra e ocupa 2 unidades UTF-16: 80 delas passam, 81 não.
    const name = `𝐀𝐀 ${"𝐀".repeat(profileLimits.displayNameMax - 3)}`;
    expect(parseProfileInput({ ...profile, displayName: name }).displayName).toBe(name);
  });

  it("nome só com espaços ou com caractere de controle é recusado", () => {
    expect(fieldsOf(() => parseProfileInput({ ...profile, displayName: "     " }))).toEqual(["displayName"]);
    expect(fieldsOf(() => parseProfileInput({ ...profile, displayName: "Ana\u0000Souza" }))).toEqual(["displayName"]);
  });

  it("código IBGE precisa ter 7 dígitos", () => {
    expect(fieldsOf(() => parseProfileInput({ ...profile, municipalityCode: 355030 }))).toEqual(["municipalityCode"]);
    expect(fieldsOf(() => parseProfileInput({ ...profile, municipalityCode: "3550308" }))).toEqual(["municipalityCode"]);
  });

  it("recusa campos fora da lista (ex.: tentar mandar status ou access_status)", () => {
    expect(fieldsOf(() => parseProfileInput({ ...profile, accessStatus: "active" }))).toEqual(["(raiz)"]);
  });

  it("o erro cita os campos, nunca os valores (R11)", () => {
    const secret = "Nome Que Não Pode Vazar".repeat(5);
    try {
      parseProfileInput({ ...profile, displayName: secret });
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).not.toContain("Nome Que");
      expect((error as Error).message).toContain("displayName");
    }
  });
});

describe("parseProfileContactInput", () => {
  it("aceita WhatsApp em E.164 e lista de redes vazia por padrão", () => {
    expect(parseProfileContactInput(contact)).toEqual({ whatsapp: "+5511999998888", socialLinks: [] });
  });

  it("recusa WhatsApp fora do E.164", () => {
    for (const whatsapp of ["11999998888", "+55 11 99999-8888", "+0123456789", "+55119"]) {
      expect(fieldsOf(() => parseProfileContactInput({ whatsapp }))).toEqual(["whatsapp"]);
    }
  });

  it("aceita até 5 URLs https", () => {
    const links = Array.from({ length: 5 }, (_, i) => `https://rede.example/perfil${i}`);
    expect(parseProfileContactInput({ ...contact, socialLinks: links }).socialLinks).toEqual(links);
  });

  it("recusa 6 URLs, URL sem https, URL longa demais e links repetidos", () => {
    const six = Array.from({ length: 6 }, (_, i) => `https://rede.example/p${i}`);
    expect(fieldsOf(() => parseProfileContactInput({ ...contact, socialLinks: six }))).toEqual(["socialLinks"]);
    expect(fieldsOf(() => parseProfileContactInput({ ...contact, socialLinks: ["http://rede.example/a"] }))).toEqual(["socialLinks.0"]);
    expect(fieldsOf(() => parseProfileContactInput({ ...contact, socialLinks: ["javascript:alert(1)"] }))).toEqual(["socialLinks.0"]);
    const long = `https://rede.example/${"a".repeat(profileLimits.socialLinkMaxLength)}`;
    expect(fieldsOf(() => parseProfileContactInput({ ...contact, socialLinks: [long] }))).toEqual(["socialLinks.0"]);
    const dup = ["https://rede.example/a", "https://rede.example/a"];
    expect(fieldsOf(() => parseProfileContactInput({ ...contact, socialLinks: dup }))).toEqual(["socialLinks"]);
  });
});

describe("parseProfileBackgroundInput (formação e atividade, #304)", () => {
  it("tudo é opcional: vazio vira null", () => {
    expect(parseProfileBackgroundInput({})).toEqual({ educationLevel: null, educationDetail: null, occupation: null });
  });

  it("nível é lista fechada, e o texto sai normalizado", () => {
    expect(
      parseProfileBackgroundInput({ educationLevel: "postgraduate", educationDetail: "  Saúde   Pública ", occupation: " Professora  de  matemática " }),
    ).toEqual({ educationLevel: "postgraduate", educationDetail: "Saúde Pública", occupation: "Professora de matemática" });
    for (const educationLevel of educationLevels) expect(() => parseProfileBackgroundInput({ educationLevel })).not.toThrow();
    for (const educationLevel of ["doctorate", "", "SUPERIOR", 3]) {
      expect(fieldsOf(() => parseProfileBackgroundInput({ educationLevel }))).toEqual(["educationLevel"]);
    }
  });

  it('"qual?" só vale em superior e pós; nos outros níveis (ou sem nível) é descartado', () => {
    for (const educationLevel of ["elementary", "high_school", null]) {
      expect(parseProfileBackgroundInput({ educationLevel, educationDetail: "Engenharia" }).educationDetail).toBeNull();
    }
    for (const educationLevel of ["college_incomplete", "college_complete", "postgraduate"]) {
      expect(parseProfileBackgroundInput({ educationLevel, educationDetail: "Engenharia" }).educationDetail).toBe("Engenharia");
    }
  });

  it("texto livre: de 2 a 80 caracteres, sem caractere de controle", () => {
    expect(parseProfileBackgroundInput({ occupation: "TI" }).occupation).toBe("TI");
    expect(parseProfileBackgroundInput({ occupation: "é".repeat(80) }).occupation).toHaveLength(80);
    for (const occupation of ["A", "a".repeat(81), "   ", "Pedreiro\u0000"]) {
      expect(fieldsOf(() => parseProfileBackgroundInput({ occupation }))).toEqual(["occupation"]);
    }
    expect(fieldsOf(() => parseProfileBackgroundInput({ educationLevel: "college_complete", educationDetail: "x" }))).toEqual(["educationDetail"]);
  });

  it("campo desconhecido é recusado, e o erro cita só o nome do campo (R11)", () => {
    expect(fieldsOf(() => parseProfileBackgroundInput({ occupation: "Dentista", cpf: "1" }))).toEqual(["(raiz)"]);
    try {
      parseProfileBackgroundInput({ occupation: "x" });
    } catch (error) {
      expect((error as Error).message).not.toContain("x ");
    }
  });
});

describe("serializeSocialLinks", () => {
  it("vira JSON para cifrar, ou null quando não há links", () => {
    expect(serializeSocialLinks([])).toBeNull();
    expect(serializeSocialLinks(["https://rede.example/a"])).toBe('["https://rede.example/a"]');
  });

  it("o pior caso permitido cabe no teto da coluna cifrada (4096)", () => {
    const worst = Array.from({ length: profileLimits.socialLinksMax }, () => `https://${"a".repeat(profileLimits.socialLinkMaxLength - 8)}`);
    const plaintextBytes = Buffer.byteLength(serializeSocialLinks(worst) ?? "");
    // v<3 dígitos>. + IV (16) + . + base64url(texto + tag de 16 bytes)
    const encryptedLength = 5 + 16 + 1 + Math.ceil(((plaintextBytes + 16) * 4) / 3);
    expect(encryptedLength).toBeLessThanOrEqual(4096);
  });

  it("o maior nome permitido cabe no teto da coluna cifrada (512)", () => {
    const plaintextBytes = Buffer.byteLength("😀".repeat(profileLimits.displayNameMax));
    const encryptedLength = 5 + 16 + 1 + Math.ceil(((plaintextBytes + 16) * 4) / 3);
    expect(encryptedLength).toBeLessThanOrEqual(512);
  });
});
