import { describe, expect, it } from "vitest";
import { consentFormSchema, consentGate, parseConsentTerm } from "./consent";

const valid = {
  version: "v1",
  title: "Seus dados",
  intro: "Leia com calma.",
  sections: [{ heading: "Para que usamos", paragraphs: ["Para organizar as equipes."] }],
  checkboxLabel: "Li e concordo",
  continueButton: "Continuar",
  uncheckedHint: "Marque a caixa para continuar.",
  declineButton: "Não concordo e quero sair",
  errors: { unchecked: "Marque a caixa.", failed: "Não deu certo. Tente de novo." },
};

describe("consentGate", () => {
  const currentVersion = "v2";

  it("perfil na versão atual → segue", () => {
    expect(consentGate({ profileVersion: "v2", pendingVersion: null, currentVersion })).toBe("ok");
  });

  it("versão mudou → pede novo aceite", () => {
    expect(consentGate({ profileVersion: "v1", pendingVersion: null, currentVersion })).toBe("needs_term");
  });

  it("perfil novo ('none') → vai ao termo, mesmo com cookie pendente", () => {
    expect(consentGate({ profileVersion: "none", pendingVersion: "v2", currentVersion })).toBe("needs_term");
  });

  it("sem perfil e sem aceite pendente → vai ao termo", () => {
    expect(consentGate({ profileVersion: null, pendingVersion: null, currentVersion })).toBe("needs_term");
  });

  it("sem perfil com aceite pendente da versão atual → segue para o cadastro", () => {
    expect(consentGate({ profileVersion: null, pendingVersion: "v2", currentVersion })).toBe("ok");
  });

  it("sem perfil com aceite pendente de versão antiga → vai ao termo", () => {
    expect(consentGate({ profileVersion: null, pendingVersion: "v1", currentVersion })).toBe("needs_term");
  });
});

describe("parseConsentTerm", () => {
  it("aceita um termo completo", () => {
    expect(parseConsentTerm(valid).version).toBe("v1");
  });

  it("recusa a versão 'none', que significa sem aceite", () => {
    expect(() => parseConsentTerm({ ...valid, version: "none" })).toThrow("version");
  });

  it("recusa versão fora do formato", () => {
    expect(() => parseConsentTerm({ ...valid, version: "v 1" })).toThrow("version");
  });

  it("recusa trecho [jurídico] ou [decidir] que sobrou na tela", () => {
    const withLegal = { ...valid, sections: [{ heading: "Idade", paragraphs: ["Só maiores. [jurídico: confirmar]"] }] };
    expect(() => parseConsentTerm(withLegal)).toThrow("sections.0.paragraphs.0");
    const withDecide = { ...valid, intro: "[decidir] listas" };
    expect(() => parseConsentTerm(withDecide)).toThrow("intro");
  });

  it("recusa texto vazio", () => {
    expect(() => parseConsentTerm({ ...valid, checkboxLabel: "  " })).toThrow("checkboxLabel");
  });
});

describe("consentFormSchema", () => {
  it("caixa marcada → aceito", () => {
    expect(consentFormSchema.safeParse({ accepted: "on" }).success).toBe(true);
  });

  it("caixa desmarcada (campo ausente) → recusado", () => {
    expect(consentFormSchema.safeParse({ accepted: null }).success).toBe(false);
  });

  it("outro valor → recusado", () => {
    expect(consentFormSchema.safeParse({ accepted: "false" }).success).toBe(false);
  });
});
