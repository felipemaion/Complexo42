import { describe, expect, it } from "vitest";
import { instance } from "@config/instance";
import { InstanceConfigError, parseInstanceConfig, roleKeys } from "./schema";

const valid = {
  name: "Nome",
  shortName: "Curto",
  colors: { primary: "#000000", secondary: "#FFFFFF" },
  roleLabels: Object.fromEntries(roleKeys.map((k) => [k, `rótulo ${k}`])),
  home: { title: "Título", message: "Mensagem" },
  waitlist: { title: "Espera", message: "Mensagem de espera" },
  auth: {
    title: "t",
    intro: "t",
    googleButton: "t",
    emailLabel: "t",
    emailButton: "t",
    emailNeedsScript: "t",
    emailSent: "t",
    signedOut: "t",
    signOutButton: "t",
    signedInTitle: "t",
    signedInMessage: "t",
    connectedAs: "t",
    confirmTitle: "t",
    confirmMessage: "t",
    confirmButton: "t",
    errors: { invalid_email: "t", rate_limited: "t", unavailable: "t", failed: "t", blocked: "t" },
  },
  profile: {
    title: "t",
    intro: "t",
    nameLabel: "t",
    nameHint: "t",
    whatsappLabel: "t",
    whatsappHint: "t",
    municipalityLabel: "t",
    municipalityPlaceholder: "t",
    districtLabel: "t",
    districtHint: "t",
    districtNone: "t",
    socialLinksLabel: "t",
    socialLinksHint: "t",
    socialLinkLabel: "t",
    addSocialLink: "t",
    removeSocialLink: "t",
    socialLinksUnreadable: "t",
    replaceSocialLinks: "t",
    socialLinksTitle: "t",
    saveButton: "t",
    saving: "t",
    saved: "t",
    editLink: "t",
    errorSummary: "t",
    fieldErrors: { displayName: "t", whatsapp: "t", municipalityCode: "t", district: "t", socialLinks: "t" },
    duplicateWhatsapp: "t",
    tooManyAttempts: "t",
    failed: "t",
  },
  myData: { downloadButton: "t", downloadHint: "t", rateLimited: "t", failed: "t", fileDescription: "t" },
  deleteAccount: {
    homeLink: "t",
    title: "t",
    warnings: ["t"],
    reauthMessage: "t",
    reauthButton: "t",
    confirmLabel: "t",
    confirmButton: "t",
    cancelLink: "t",
    invalidConfirmation: "t",
    reauthRequired: "t",
    failed: "t",
    goodbyeTitle: "t",
    goodbyeMessage: "t",
    goodbyeLink: "t",
  },
  contactVisibility: {
    title: "t",
    homeLink: "t",
    intro: "t",
    kinds: { whatsapp: "t", social: "t", email: "t" },
    scopes: { none: "t", team: "t", team_house: "t" },
    explain: { none: "t", team: "t", team_house: "t" },
    leaveNote: "t",
    saved: "t",
    failed: "t",
    viewsTitle: "t",
    viewsEmpty: "t",
    viewsLine: "{name} {kind} {date}",
    viewsKinds: { whatsapp: "t", social: "t", email: "t" },
    viewsUnknownPerson: "t",
    viewsNote: "t",
  },
  houseSelection: {
    title: "t",
    knowsQuestion: "t",
    knowsYes: "t",
    knowsNo: "t",
    activitiesTitle: "t",
    consentTitle: "t",
    consentAccept: "t",
    consentDecline: "t",
    progress: "{current} de {total}",
    bothButton: "t",
    backButton: "t",
    suggestedTitle: "t",
    chosenTitle: "t",
    firstStepsTitle: "t",
    videosTitle: "t",
    acceptButton: "t",
    chooseOtherButton: "t",
    acceptedTitle: "t",
    homeLink: "t",
    errors: {
      unavailable: "t",
      already_accepted: "t",
      not_active: "t",
      stale_consent: "t",
      removed_by_coordination: "t",
      failed: "t",
    },
  },
  missions: instance.missions,
  search: instance.search,
  coordination: {
    homeLink: "t",
    title: "t",
    intro: "t",
    backLink: "t",
    homeBackLink: "t",
    allowlist: {
      menuLink: "t",
      title: "t",
      intro: "t",
      privacyNote: "t",
      fileLabel: "t",
      fileHint: "t",
      sourceLabel: "t",
      sources: { academy: "t", form: "t", manual: "t" },
      submitButton: "t",
      sending: "t",
      doneTitle: "t",
      received: "t",
      promoted: "t",
      invalidLines: "t",
      invalidLinesMore: "t",
      invalidLinesTotal: "t",
      errors: {
        no_file: "t",
        wrong_type: "t",
        too_large: "t",
        too_many: "t",
        empty: "t",
        invalid_source: "t",
        forbidden: "t",
        failed: "t",
      },
    },
    waitlist: {
      menuLink: "t",
      title: "t",
      intro: "t",
      empty: "t",
      since: "t",
      place: "t",
      approveButton: "t",
      blockButton: "t",
      confirmApprove: "t",
      confirmBlock: "t",
      confirmApproveButton: "t",
      confirmBlockButton: "t",
      cancelButton: "t",
      unknownName: "t",
      unknownNameNote: "t",
      nextPage: "t",
      firstPage: "t",
      done: { liberado: "t", bloqueado: "t", indisponivel: "t", erro: "t" },
    },
    memberBlock: {
      menuLink: "t",
      title: "t",
      intro: "t",
      emailLabel: "t",
      actionLabel: "t",
      actions: { block: "t", unblock: "t" },
      reasonLabel: "t",
      reasonNone: "t",
      reasons: { impersonation: "t", conduct: "t", other: "t" },
      continueButton: "t",
      confirm: { block: "t", unblock: "t" },
      confirmReason: "t",
      confirmButton: { block: "t", unblock: "t" },
      cancelButton: "t",
      done: { block: "t", unblock: "t" },
      errors: { invalid_email: "t", invalid_action: "t", invalid_reason: "t", forbidden: "t", rate_limited: "t", failed: "t" },
    },
  },
  houses: [
    { id: "a", name: "A", description: "d", activities: ["x"], firstSteps: { text: "t", videoUrls: ["https://v.example/1"] } },
    { id: "b", name: "B", description: "d", activities: ["y"], firstSteps: { text: "t" } },
  ],
};

function fieldsOf(raw: unknown): string[] {
  try {
    parseInstanceConfig(raw);
  } catch (error) {
    expect(error).toBeInstanceOf(InstanceConfigError);
    return (error as InstanceConfigError).fields;
  }
  throw new Error("esperava InstanceConfigError");
}

describe("parseInstanceConfig", () => {
  it("aceita uma configuração válida e preenche os vídeos ausentes", () => {
    const config = parseInstanceConfig(valid);
    expect(config.houses[1]?.firstSteps.videoUrls).toEqual([]);
    expect(Object.isFrozen(config)).toBe(true);
  });

  it("config/instance.ts é válida e tem rótulo para todo papel genérico", () => {
    for (const key of roleKeys) expect(instance.roleLabels[key]).toMatch(/\S/);
    expect(instance.houses.length).toBeGreaterThan(0);
  });

  it("falha citando os campos inválidos, sem expor os valores", () => {
    const raw = {
      ...valid,
      name: "  ",
      colors: { primary: "VALOR-SECRETO", secondary: "#fff" },
      roleLabels: { ...valid.roleLabels, manager: undefined },
    };
    let message = "";
    try {
      parseInstanceConfig(raw);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(fieldsOf(raw)).toEqual(["name", "colors.primary", "colors.secondary", "roleLabels.manager"]);
    expect(message).toContain("colors.primary");
    expect(message).not.toContain("VALOR-SECRETO");
  });

  it("recusa campo desconhecido, papel fora da lista e lista de casas vazia", () => {
    expect(fieldsOf({ ...valid, extra: 1 })).toEqual(["(raiz)"]);
    expect(fieldsOf({ ...valid, roleLabels: { ...valid.roleLabels, student: "x" } })).toEqual(["roleLabels"]);
    expect(fieldsOf({ ...valid, houses: [] })).toEqual(["houses"]);
    expect(fieldsOf({ ...valid, waitlist: { title: "Espera", message: " " } })).toEqual(["waitlist.message"]);
  });

  it("recusa id de casa repetido, id fora do padrão e vídeo sem https", () => {
    const [a, b] = valid.houses;
    expect(fieldsOf({ ...valid, houses: [a, { ...b, id: "a" }] })).toEqual(["houses.1.id"]);
    expect(fieldsOf({ ...valid, houses: [{ ...a, id: "Casa A" }] })).toEqual(["houses.0.id"]);
    expect(fieldsOf({ ...valid, houses: [{ ...a, id: "a".repeat(64) }] })).toEqual(["houses.0.id"]);
  });

  it("escolha da casa (#76): atividades obrigatórias e únicas; progresso com {current} e {total}", () => {
    const [a, b] = valid.houses;
    expect(fieldsOf({ ...valid, houses: [{ ...a, activities: [] }, b] })).toEqual(["houses.0.activities"]);
    expect(fieldsOf({ ...valid, houses: [a, { ...b, activities: ["x"] }] })).toEqual(["houses.1.activities.0"]);
    expect(fieldsOf({ ...valid, houseSelection: { ...valid.houseSelection, progress: "{current}" } })).toEqual([
      "houseSelection.progress",
    ]);
    expect(
      fieldsOf({ ...valid, houses: [{ ...a, firstSteps: { text: "t", videoUrls: ["http://v.example/1"] } }] }),
    ).toEqual(["houses.0.firstSteps.videoUrls.0"]);
  });
});
