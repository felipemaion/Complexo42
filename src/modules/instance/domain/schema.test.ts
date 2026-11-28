import { describe, expect, it } from "vitest";
import { instance } from "@config/instance";
import { InstanceConfigError, parseInstanceConfig, roleKeys } from "./schema";

const valid = {
  name: "Nome",
  shortName: "Curto",
  colors: { primary: "#000000", secondary: "#FFFFFF" },
  roleLabels: Object.fromEntries(roleKeys.map((k) => [k, `rótulo ${k}`])),
  home: { title: "Título", message: "Mensagem" },
  waitlist: { title: "Espera", message: "Mensagem de espera", signOutButton: "Sair" },
  auth: {
    title: "t",
    intro: "t",
    googleButton: "t",
    emailLabel: "t",
    emailButton: "t",
    passwordLabel: "t",
    passwordButton: "t",
    recoverButton: "t",
    recoverySent: "t",
    emailNeedsScript: "t",
    emailSent: "t",
    signedOut: "t",
    signOutButton: "t",
    signedInTitle: "t",
    signedInMessage: "t",
    connectedAs: "t",
    navLabel: "t",
    navHome: "t",
    navBack: "t",
    confirmTitle: "t",
    confirmMessage: "t",
    confirmButton: "t",
    errors: { invalid_email: "t", rate_limited: "t", unavailable: "t", failed: "t", blocked: "t", legacy_link: "t", bad_credentials: "t", session_expired: "t" },
  },
  password: {
    title: "t",
    homeLink: "t",
    intro: "t",
    rules: "t",
    googleMessage: "t",
    currentLabel: "t",
    currentHint: "t",
    newLabel: "t",
    confirmLabel: "t",
    saveButton: "t",
    removeButton: "t",
    removeHint: "t",
    sectionTitle: "t",
    meterLabel: "t",
    strength: { weak: "t", ok: "t", strong: "t" },
    status: { saved: "t", removed: "t" },
    errors: Object.fromEntries(
      ["too_short", "too_long", "common", "pwned", "mismatch", "current_required", "current_wrong", "reauth_needed", "same", "rate_limited", "unavailable", "failed"].map((k) => [k, "t"]),
    ),
  },
  emails: {
    expires: "t",
    fallback: "t",
    footer: "t",
    templates: Object.fromEntries(
      ["magic-link", "confirmation", "recovery", "invite", "email-change"].map((kind) => [kind, { subject: "t", heading: "t", intro: "t", button: "t" }]),
    ),
  },
  profile: {
    title: "t",
    intro: "t",
    nameLabel: "t",
    nameHint: "t",
    whatsappLabel: "t",
    whatsappHint: "t",
    stateLabel: "t",
    statePlaceholder: "t",
    municipalitySearchLabel: "t",
    municipalitySearchHint: "t",
    municipalityNoMatch: "t",
    municipalityLabel: "t",
    municipalityPlaceholder: "t",
    localitiesLoading: "t",
    localitiesFailed: "t",
    districtLabel: "t",
    districtHint: "t",
    districtNone: "t",
    neighborhoodLabel: "t",
    neighborhoodHint: "t",
    neighborhoodUnreadable: "t",
    replaceNeighborhood: "t",
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
    fieldErrors: { displayName: "t", whatsapp: "t", municipalityCode: "t", district: "t", neighborhood: "t", socialLinks: "t" },
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
    activitiesTitle: "t",
    consentTitle: "t",
    consentAccept: "t",
    consentDecline: "t",
    progress: "{current} de {total}",
    scaleLegend: "t",
    scaleIntensities: ["t", "t", "t", "t", "t", "t"],
    nextButton: "t",
    finishButton: "t",
    chartTitle: "t",
    chartCurrentHouse: "t",
    backButton: "t",
    suggestedTitle: "t",
    chosenTitle: "t",
    firstStepsTitle: "t",
    videosTitle: "t",
    acceptButton: "t",
    chooseOtherButton: "t",
    minAverageMembers: 10,
    averageCacheSeconds: 600,
    compare: {
      title: "t", intro: "t", suggestedBadge: "t", currentBadge: "t", currentLabel: "t", suggestedLabel: "t", expiredReload: "t", selectedBadge: "t", yourProfileLabel: "t", chartTitle: "t", averageLabel: "t",
      averageNote: "t", fewMembers: "t", averageUnavailable: "t", expectTitle: "t", expectIntro: "t", expectNone: "t",
      expectUnavailable: "t", loading: "t", confirmButton: "t", backButton: "t",
    },
    submitting: "t",
    inviteMessage: "t",
    acceptedTitle: "t",
    homeLink: "t",
    rateLimitedWait: "{minutes}",
    consentLockNotice: "t",
    consentStoredNotice: "t",
    lockedUntilNotice: "{date}",
    changeHouseLink: "t",
    continueLink: "t",
    errors: {
      unavailable: "t",
      already_accepted: "t",
      not_active: "t",
      stale_consent: "t",
      removed_by_coordination: "t",
      house_locked: "t",
      house_conflict: "t",
      app_updated: "t",
      rate_limited: "t",
      failed: "t",
    },
  },
  questionnaireCoordination: {
    linkResults: "t", linkQueue: "t", linkDelegations: "t", backLink: "t", noName: "t",
    results: {
      title: "t", intro: "t", houseFilterLabel: "t", houseFilterAll: "t", filterButton: "t", empty: "t",
      columnPerson: "t", columnHouse: "t", columnDate: "t", openLink: "t",
      truncated: "{count}", detailTitle: "{name}", houseLabel: "t", totemLabel: "t", dateLabel: "t",
      chartTitle: "t", chartCurrentHouse: "t", totemPending: "t", totemUndecided: "t", noScores: "t", columnChosen: "t", chosenNone: "t", differsMark: "t", changedByCoordination: "{date}", otherHouseFilter: "t", chosenLabel: "t", chosenDateLabel: "t", changeHouseTitle: "t", changeHouseLabel: "t", changeHouseButton: "t", changedNotice: "t", unreadableOne: "t", backLink: "t",
    },
    queue: {
      title: "t", intro: "t", empty: "t", columnPerson: "t", columnDate: "t", columnAxes: "t", kindTotem: "t", legacyKey: "t", legacyKeyNotice: "t", openLink: "t",
      truncated: "{count}", unreadableList: "{count}", caseTitle: "{name}", tiedAxesLabel: "t", answersTitle: "t", chartTitle: "t", chartCurrentHouse: "t",
      resolveTitle: "t", totemOnlyNotice: "{house}", houseLabel: "t", totemLabel: "t", totemOption: "{label}{description}",
      resolveButton: "t", resolvedNotice: "t", unreadableOne: "t", backLink: "t",
    },
    delegations: {
      title: "t", intro: "t", activeTitle: "t", empty: "t", columnManager: "t", columnUnit: "t", columnDate: "t",
      revokeButton: "t", grantTitle: "t", managerLabel: "t", grantButton: "t", noCandidates: "t",
      grantedNotice: "t", revokedNotice: "t",
    },
    errors: { forbidden: "t", invalid: "t", not_found: "t", exists: "t", changed: "t", failed: "t" },
  },
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
      addEmail: {
        title: "t",
        label: "t",
        hint: "t",
        button: "t",
        adding: "t",
        added: "t",
        already: "t",
        errors: { invalid_email: "t", forbidden: "t", rate_limited: "t", failed: "t" },
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
      unknownName: "t", incompleteProfile: "t",
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
    { id: "a", name: "A", color: { light: "#c0392b", dark: "#f0786b" }, description: "d", activities: ["x"], firstSteps: { text: "t", videoUrls: ["https://v.example/1"] } },
    { id: "b", name: "B", color: { light: "#2563c9", dark: "#7aa8f5" }, description: "d", activities: ["y"], firstSteps: { text: "t" } },
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
  it("piso de privacidade do perfil médio (#240): no mínimo 10 membros e cache de no mínimo 10 minutos; o exemplo valido tem o piso", () => {
    const hs = valid.houseSelection;
    expect(fieldsOf({ ...valid, houseSelection: { ...hs, minAverageMembers: 9 } })).toEqual(["houseSelection.minAverageMembers"]);
    expect(fieldsOf({ ...valid, houseSelection: { ...hs, minAverageMembers: 1 } })).toEqual(["houseSelection.minAverageMembers"]);
    expect(fieldsOf({ ...valid, houseSelection: { ...hs, averageCacheSeconds: 599 } })).toEqual(["houseSelection.averageCacheSeconds"]);
    expect(() => parseInstanceConfig({ ...valid, houseSelection: { ...hs, minAverageMembers: 10, averageCacheSeconds: 600 } })).not.toThrow();
  });

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
    expect(fieldsOf({ ...valid, waitlist: { title: "Espera", message: " ", signOutButton: "Sair" } })).toEqual(["waitlist.message"]);
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
