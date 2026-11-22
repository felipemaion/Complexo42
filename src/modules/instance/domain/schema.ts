import { z } from "zod";

/**
 * Chaves genéricas de papel (ADR 0002/0005, docs/MODELO_DADOS.md). `member` é quem só participa
 * de unidades; as demais são os valores de `role_assignments.role`. O código usa sempre a chave;
 * o texto exibido vem de `config/instance.ts` (R17).
 */
export const roleKeys = ["member", "monitor", "manager", "spokesperson", "tech_admin"] as const;

const text = z.string().trim().min(1);
const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, "cor no formato #RRGGBB");
const httpsUrl = z.url({ protocol: /^https$/ });
const slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "id em minúsculas, números e hífens");

const roleLabelsShape = Object.fromEntries(roleKeys.map((key) => [key, text])) as Record<
  (typeof roleKeys)[number],
  typeof text
>;

const houseSchema = z.strictObject({
  /**
   * Identificador estável da casa. Liga a casa à unidade do eixo `house` (#76): o `slug` da
   * unidade é este id com `_` no lugar de `-`, e por isso tem no máximo 63 caracteres.
   */
  id: slug.max(63),
  name: text,
  /** Descrição curta exibida na escolha da casa. */
  description: text,
  /**
   * Atividades que levam a esta casa, na lista de quem já sabe o que quer fazer (#76). Cada
   * atividade aponta para uma casa só.
   */
  activities: z.array(text).min(1),
  /** "Primeiros passos": história e objetivos da casa, com vídeos opcionais (ADR 0008 §2). */
  firstSteps: z.strictObject({
    text,
    videoUrls: z.array(httpsUrl).default([]),
  }),
});

export const instanceConfigSchema = z.strictObject({
  /** Nome completo da instância (título do site). */
  name: text,
  /** Nome curto (menus, ícone do app). */
  shortName: text.max(24),
  colors: z.strictObject({
    primary: hexColor,
    secondary: hexColor,
  }),
  roleLabels: z.strictObject(roleLabelsShape),
  /** Textos da página inicial enquanto o produto não abre. */
  home: z.strictObject({
    title: text,
    message: text,
  }),
  /** Tela de quem está na lista de espera (ADR 0008 §1): ainda não liberado pela coordenação. */
  waitlist: z.strictObject({
    title: text,
    message: text,
  }),
  /** Textos do login (#9). Botões grandes e nada escondido (pedido do stakeholder). */
  auth: z.strictObject({
    title: text,
    intro: text,
    googleButton: text,
    emailLabel: text,
    emailButton: text,
    emailNeedsScript: text,
    emailSent: text,
    signedOut: text,
    signOutButton: text,
    signedInTitle: text,
    signedInMessage: text,
    /** Rótulo antes do e-mail mascarado de quem está logado (ex.: "Conectado como"). */
    connectedAs: text,
    /** Página intermediária do link mágico: o login só acontece no clique (POST). */
    confirmTitle: text,
    confirmMessage: text,
    confirmButton: text,
    /** Mensagens por código de erro. A tela só mostra códigos conhecidos, nunca texto da URL. */
    errors: z.strictObject({
      invalid_email: text,
      rate_limited: text,
      unavailable: text,
      failed: text,
      blocked: text,
    }),
  }),
  /** Formulário do perfil (#12): nome, WhatsApp e localização. Linguagem simples. */
  profile: z.strictObject({
    title: text,
    intro: text,
    nameLabel: text,
    nameHint: text,
    whatsappLabel: text,
    whatsappHint: text,
    municipalityLabel: text,
    municipalityPlaceholder: text,
    districtLabel: text,
    districtHint: text,
    /** Opção vazia do distrito (ele é opcional). */
    districtNone: text,
    /** Redes sociais (#17): grupo do formulário, cada caixa ("Link 1"...) e os botões. */
    socialLinksLabel: text,
    socialLinksHint: text,
    socialLinkLabel: text,
    addSocialLink: text,
    removeSocialLink: text,
    /** Links guardados que não abriram: aviso de que continuam guardados e o botão para trocar. */
    socialLinksUnreadable: text,
    replaceSocialLinks: text,
    /** Título da lista dos links salvos na página inicial. */
    socialLinksTitle: text,
    saveButton: text,
    saving: text,
    /** Aviso na página inicial depois de salvar. */
    saved: text,
    /** Botão da página inicial para voltar ao formulário. */
    editLink: text,
    /** Título da lista de erros no topo do formulário. */
    errorSummary: text,
    /** Mensagem de cada campo inválido. */
    fieldErrors: z.strictObject({
      displayName: text,
      whatsapp: text,
      municipalityCode: text,
      district: text,
      socialLinks: text,
    }),
    /** WhatsApp já usado em outro cadastro (não diz de quem). */
    duplicateWhatsapp: text,
    /** Muitas tentativas com WhatsApp repetido (#127): neutro, sem dizer nada do número. */
    tooManyAttempts: text,
    failed: text,
  }),
  /** "Baixar meus dados" (#20, LGPD art. 18). */
  myData: z.strictObject({
    downloadButton: text,
    downloadHint: text,
    /** Mais de 5 exportações na mesma hora. */
    rateLimited: text,
    failed: text,
    /** Campo `sobre.descricao` do arquivo baixado. */
    fileDescription: text,
  }),
  /** "Excluir minha conta" (#18, LGPD art. 18, VI). */
  deleteAccount: z.strictObject({
    homeLink: text,
    title: text,
    /** Avisos antes da confirmação, um por parágrafo. */
    warnings: z.array(text).min(1),
    /** O último login tem mais de 10 minutos: pede para entrar de novo. */
    reauthMessage: text,
    reauthButton: text,
    confirmLabel: text,
    confirmButton: text,
    cancelLink: text,
    invalidConfirmation: text,
    reauthRequired: text,
    failed: text,
    goodbyeTitle: text,
    goodbyeMessage: text,
    goodbyeLink: text,
  }),
  /** "Quem vê meu contato" (#119, ADR 0010). */
  contactVisibility: z.strictObject({
    title: text,
    homeLink: text,
    intro: text,
    /** Nome de cada contato na tela da escolha. */
    kinds: z.strictObject({ whatsapp: text, social: text, email: text }),
    /** Texto do botão de cada escolha. */
    scopes: z.strictObject({ none: text, team: text, team_house: text }),
    /** Quem vê, em uma frase, para a escolha atual. */
    explain: z.strictObject({ none: text, team: text, team_house: text }),
    leaveNote: text,
    saved: text,
    failed: text,
    viewsTitle: text,
    viewsEmpty: text,
    /** Linha da lista: `{name}`, `{kind}` e `{date}`. */
    viewsLine: text,
    /** O contato visto, dentro da frase da lista. */
    viewsKinds: z.strictObject({ whatsapp: text, social: text, email: text }),
    /** Quem viu e depois excluiu a conta. */
    viewsUnknownPerson: text,
    viewsNote: text,
  }),
  /**
   * Textos da escolha da casa (#76, ADR 0008 §2 e §2.1). O texto do termo do questionário vem
   * do arquivo do questionário, não daqui.
   */
  houseSelection: z.strictObject({
    title: text,
    /** Pergunta inicial: "Você sabe o que quer fazer?". */
    knowsQuestion: text,
    knowsYes: text,
    knowsNo: text,
    activitiesTitle: text,
    consentTitle: text,
    consentAccept: text,
    /** Recusar o termo leva à escolha direta (join_method = self). */
    consentDecline: text,
    /** Progresso do questionário, com `{current}` e `{total}` (ex.: "{current} de {total}"). */
    progress: text.refine((v) => v.includes("{current}") && v.includes("{total}"), "use {current} e {total}"),
    /** Botão de quem marca as duas alternativas (indecisão). */
    bothButton: text,
    backButton: text,
    /** Título do resultado do questionário (a casa sugerida). */
    suggestedTitle: text,
    /** Título da apresentação de uma casa escolhida na lista. */
    chosenTitle: text,
    firstStepsTitle: text,
    videosTitle: text,
    acceptButton: text,
    chooseOtherButton: text,
    /** Tela de quem já aceitou a casa. */
    acceptedTitle: text,
    /** Link da página inicial para a escolha da casa. */
    homeLink: text,
    errors: z.strictObject({
      /** A casa não existe no banco ou está inativa. */
      unavailable: text,
      /** A pessoa já aceitou outra casa. */
      already_accepted: text,
      /** Cadastro incompleto ou acesso ainda não liberado. */
      not_active: text,
      /** O termo mudou enquanto a pessoa respondia: recarregar. */
      stale_consent: text,
      /** A coordenação encerrou a casa da pessoa: a volta é com ela. */
      removed_by_coordination: text,
      failed: text,
    }),
  }),
  /**
   * Telas da coordenação (#26, ADR 0008 §1): envio da lista de autorizados e fila de espera.
   * `{count}`, `{lines}`, `{date}`, `{city}`, `{state}` e `{name}` são trocados na tela.
   */
  dashboard: z.strictObject({
    title: text, teamLabel: text, membersLabel: text, activeLabel: text, completedLabel: text, pointsLabel: text, empty: text,
  }),
  evaluations: z.strictObject({
    enabled: z.boolean(),
    title: text,
    gradeLabel: text,
    grades: z.strictObject({ bronze: text, prata: text, ouro: text }),
    noteLabel: text,
    submitButton: text,
    done: text,
    errors: z.strictObject({ not_allowed: text, invalid: text, failed: text }),
  }),
  teamChat: z.strictObject({
    enabled: z.boolean(),
    title: text,
    empty: text,
    messageLabel: text,
    sendButton: text,
    you: text,
    privacyNote: text,
    errors: z.strictObject({ not_allowed: text, invalid: text, too_many: text, failed: text }),
  }),
  draft: z.strictObject({
    title: text, intro: text, sliceLabel: text, openButton: text, needTwoTeams: text, onTurn: text, closeButton: text,
    yourTurn: text, waiting: text, pickButton: text,
    done: z.strictObject({ opened: text, picked: text, closed: text }),
    errors: z.strictObject({ not_allowed: text, invalid: text, failed: text }),
  }),
  evaluationAccess: z.strictObject({
    title: text, intro: text, personLabel: text, reasonLabel: text, button: text, none: text,
    errors: z.strictObject({ not_allowed: text, invalid: text, failed: text }),
  }),
  myTeam: z.strictObject({ homeLink: text, title: text, noTeam: text, membersTitle: text, leadTag: text }),
  // Identidade da equipe (#56): lema, cores e emblema.
  // Portfólio por links (#70): até 3 itens, sem arquivo.
  // Propostas de missão pela equipe (#57).
  proposals: z.strictObject({
    proposeTitle: text, proposeIntro: text, proposeButton: text, myTitle: text, myEmpty: text, pendingTitle: text,
    pendingEmpty: text, scopeLabel: text, scopeTeam: text, pointsLabel: text, noteLabel: text, approveButton: text,
    rejectButton: text, proposedBy: text,
    status: z.strictObject({ proposed: text, published: text, archived: text }),
    done: z.strictObject({ proposed: text, approved: text, rejected: text }),
    errors: z.strictObject({ invalid: text, not_allowed: text, too_many: text, failed: text }),
  }),
  portfolio: z.strictObject({
    homeLink: text, title: text, intro: text, empty: text, addTitle: text, urlLabel: text, titleLabel: text,
    kindLabel: text, addButton: text, removeButton: text, full: text, openLink: text,
    kinds: z.strictObject({ video: text, image: text, text: text, other: text }),
    done: z.strictObject({ added: text, removed: text }),
    errors: z.strictObject({ invalid: text, full: text, not_allowed: text, failed: text }),
  }),
  priorTeams: z.strictObject({
    homeLink: text, title: text, intro: text, selfNote: text, coordinationTitle: text, coordinationNote: text, empty: text,
    addTitle: text, teamNameLabel: text, periodLabel: text, roleLabel: text,
    roles: z.strictObject({ member: text, spokesperson: text, coordinator: text }),
    addButton: text, removeButton: text, full: text,
    done: z.strictObject({ added: text, removed: text }),
    errors: z.strictObject({ invalid: text, full: text, not_allowed: text, failed: text }),
  }),
  teamIdentity: z.strictObject({
    title: text, flagLabel: text, noIdentity: text, editTitle: text, mottoLabel: text, colorsLegend: text,
    color1Label: text, color2Label: text, color3Label: text, useColor3Label: text, emblemLegend: text,
    saveButton: text, saved: text,
    emblems: z.strictObject({ estrela: text, escudo: text, tocha: text, livro: text, megafone: text, balanca: text, ponte: text, folha: text }),
    errors: z.strictObject({ not_allowed: text, invalid: text, failed: text }),
  }),
  badges: z.strictObject({
    homeLink: text,
    title: text,
    intro: text,
    myTitle: text,
    empty: text,
    grantTitle: text,
    badgeLabel: text,
    personLabel: text,
    reasonLabel: text,
    grantButton: text,
    nothingToGrant: text,
    createTitle: text,
    scopeLabel: text,
    nameLabel: text,
    descriptionLabel: text,
    iconLabel: text,
    createButton: text,
    // Como se ganha (#36): manual ou automática.
    ruleLabel: text, ruleManual: text, ruleEvent: text, ruleMilestone: text, rulePoints: text, ruleMission: text, pointsLabel: text, missionLabel: text,
    done: z.strictObject({ created: text, granted: text }),
    errors: z.strictObject({ not_allowed: text, invalid: text, already_has: text, already_revoked: text, failed: text }),
  }),
  teams: z.strictObject({
    homeLink: text,
    title: text,
    intro: text,
    createTitle: text,
    parentLabel: text,
    nameLabel: text,
    createButton: text,
    listTitle: text,
    membersSuffix: text,
    leadTag: text,
    makeLeadButton: text,
    removeButton: text,
    noMembers: text,
    addLabel: text,
    addButton: text,
    noUnassigned: text,
    noTeams: text,
    done: z.strictObject({ created: text, assigned: text, removed: text, lead: text, moved: text }),
    // Mover pessoa entre equipes (#47).
    moveLabel: text, moveButton: text,
    errors: z.strictObject({ not_allowed: text, invalid: text, failed: text }),
  }),
  nav: z.strictObject({ label: text, home: text, missions: text, myTeam: text, scoreboard: text, review: text, teams: text, search: text, badges: text, roles: text, map: text }),
  // Catálogo de habilidades (#25): só o gestor nacional.
  skillsCatalog: z.strictObject({ title: text, intro: text, homeLink: text, nameLabel: text, categoryLabel: text, aliasesLabel: text, saveButton: text, addTitle: text, addButton: text, activeTag: text, inactiveTag: text, deactivateButton: text, activateButton: text, notAllowed: text, done: text, errors: z.strictObject({ invalid: text, not_allowed: text, duplicate: text, failed: text }) }),
  // Mapa de onde estão as pessoas (#24).
  areaMap: z.strictObject({ title: text, intro: text, mapLabel: text, few: text, citiesTitle: text, districtsTitle: text, empty: text, privacyNote: text }),
  // Histórico de equipes da pessoa (#69).
  history: z.strictObject({ title: text, intro: text, current: text, since: text, until: text, spokespeople: text, noSpokesperson: text, empty: text, link: text, back: text }),
  // Delegar papéis pela tela (#22).
  roles: z.strictObject({
    title: text, intro: text, grantTitle: text, personLabel: text, roleLabel: text, unitLabel: text, grantButton: text,
    listTitle: text, empty: text, revokeButton: text,
    done: z.strictObject({ granted: text, revoked: text }),
    errors: z.strictObject({ invalid: text, not_allowed: text, already: text, failed: text }),
  }),
  // Placar de equipes por período (#58): só equipes, nunca pessoas.
  scoreboard: z.strictObject({
    title: text, intro: text, periodLabel: text, mine: text, empty: text,
    periods: z.strictObject({ "7": text, "30": text, "90": text, all: text }),
  }),
  demo: z.strictObject({
    title: text, intro: text, asMember: text, asCoordinator: text, memberHint: text, coordinatorHint: text,
    banner: text, viewingAs: text, member: text, coordinator: text, switchTo: text,
  }),
  // Moldura de site (cabeçalho, painel inicial e rodapé) das páginas de quem entrou.
  site: z.strictObject({
    tagline: text, kicker: text, greeting: text, coordinatorIntro: text, memberIntro: text,
    pendingLabel: text, availableLabel: text, openMissionsTitle: text, seeAll: text, available: text,
    leadLabel: text, openTeam: text, peopleSuffix: text, teamPointsTitle: text, pendingTitle: text,
    pendingEmpty: text, footerAbout: text, accountTitle: text, coordinationTitle: text, privacyNote: text,
  }),
  search: z.strictObject({
    homeLink: text,
    title: text,
    intro: text,
    searchButton: text,
    empty: text,
    resultsTitle: text,
    errors: z.strictObject({ invalid: text, failed: text }),
  }),
  // Missões (ADR 0006): os tipos e estados são chaves fixas do banco; o texto vem daqui (R17).
  missions: z.strictObject({
    homeLink: text,
    title: text,
    intro: text,
    empty: text,
    origin: z.strictObject({ national: text, regional: text }),
    mode: z.strictObject({ team: text, individual: text }),
    runStatus: z.strictObject({ none: text, active: text, completed: text }),
    pointsSuffix: text,
    stepsTitle: text,
    openLink: text,
    startButton: text,
    startHint: text,
    stepState: z.strictObject({ locked: text, open: text, pending: text, approved: text, rejected: text }),
    evidence: z.strictObject({ none: text, link: text, protocol_number: text, text }),
    evidenceWarning: text,
    submitButton: text,
    submitted: text,
    reviewNoteLabel: text,
    pointsTitle: text,
    teamPointsLabel: text,
    myPointsLabel: text,
    backLink: text,
    errors: z.strictObject({
      not_allowed: text,
      invalid_evidence: text,
      locked: text,
      already_done: text,
      unavailable: text,
      failed: text,
    }),
    review: z.strictObject({
      menuLink: text,
      title: text,
      intro: text,
      empty: text,
      unitLabel: text,
      evidenceLabel: text,
      noEvidence: text,
      noteLabel: text,
      approveButton: text,
      rejectButton: text,
      done: z.strictObject({ approved: text, rejected: text }),
    }),
    publish: z.strictObject({
      menuLink: text,
      title: text,
      intro: text,
      titleLabel: text,
      descriptionLabel: text,
      categoryLabel: text,
      // Chave = `missions.category` no banco (minúsculas); valor = texto exibido.
      categories: z.record(z.string().regex(/^[a-z][a-z0-9_]{0,31}$/), text).refine((c) => Object.keys(c).length > 0),
      scopeLabel: text,
      modeLabel: text,
      stepsLegend: text,
      stepTitleLabel: text,
      stepPointsLabel: text,
      stepEvidenceLabel: text,
      evidenceOptions: z.strictObject({ none: text, link: text, protocol_number: text, text }),
      publishButton: text,
      done: text,
      errors: z.strictObject({ invalid: text, not_allowed: text, failed: text }),
    }),
  }),
  coordination: z.strictObject({
    homeLink: text,
    title: text,
    intro: text,
    backLink: text,
    homeBackLink: text,
    allowlist: z.strictObject({
      menuLink: text,
      title: text,
      intro: text,
      privacyNote: text,
      fileLabel: text,
      fileHint: text,
      sourceLabel: text,
      /** Rótulo de cada origem da lista (`access_allowlist.source`). */
      sources: z.strictObject({ academy: text, form: text, manual: text }),
      submitButton: text,
      sending: text,
      doneTitle: text,
      received: text,
      promoted: text,
      invalidLines: text,
      invalidLinesMore: text,
      /** Total de linhas ruins, com `{count}` (a tela lista só as primeiras). */
      invalidLinesTotal: text,
      errors: z.strictObject({
        no_file: text,
        wrong_type: text,
        too_large: text,
        too_many: text,
        empty: text,
        invalid_source: text,
        /** O banco recusou: só o gestor da raiz importa. */
        forbidden: text,
        failed: text,
      }),
    }),
    waitlist: z.strictObject({
      menuLink: text,
      title: text,
      intro: text,
      empty: text,
      since: text,
      place: text,
      approveButton: text,
      blockButton: text,
      confirmApprove: text,
      confirmBlock: text,
      confirmApproveButton: text,
      confirmBlockButton: text,
      cancelButton: text,
      /** No lugar do nome que não pôde ser lido. */
      unknownName: text,
      /** Aviso na linha de nome ilegível: "Liberar" fica desabilitado. */
      unknownNameNote: text,
      nextPage: text,
      firstPage: text,
      /** Resultado da decisão, mostrado no topo da fila. */
      done: z.strictObject({ liberado: text, bloqueado: text, indisponivel: text, erro: text }),
    }),
    /** Bloquear ou desbloquear quem já entrou (#26). Por ação: `block` e `unblock`. */
    memberBlock: z.strictObject({
      menuLink: text,
      title: text,
      intro: text,
      emailLabel: text,
      actionLabel: text,
      actions: z.strictObject({ block: text, unblock: text }),
      reasonLabel: text,
      reasonNone: text,
      reasons: z.strictObject({ impersonation: text, conduct: text, other: text }),
      continueButton: text,
      confirm: z.strictObject({ block: text, unblock: text }),
      confirmReason: text,
      confirmButton: z.strictObject({ block: text, unblock: text }),
      cancelButton: text,
      done: z.strictObject({ block: text, unblock: text }),
      errors: z.strictObject({
        invalid_email: text,
        invalid_action: text,
        invalid_reason: text,
        forbidden: text,
        rate_limited: text,
        failed: text,
      }),
    }),
  }),
  houses: z
    .array(houseSchema)
    .min(1)
    .superRefine((houses, ctx) => {
      const seen = new Set<string>();
      const activities = new Set<string>();
      houses.forEach((house, index) => {
        if (seen.has(house.id)) {
          ctx.addIssue({ code: "custom", message: "id de casa repetido", path: [index, "id"] });
        }
        seen.add(house.id);
        house.activities.forEach((activity, i) => {
          if (activities.has(activity)) {
            ctx.addIssue({ code: "custom", message: "atividade em mais de uma casa", path: [index, "activities", i] });
          }
          activities.add(activity);
        });
      });
    }),
});

/** Erro de configuração: a mensagem cita só os campos, nunca os valores. */
export class InstanceConfigError extends Error {
  constructor(readonly fields: string[]) {
    super(`Configuração da instância inválida (config/instance.ts): ${fields.join(", ")}`);
    this.name = "InstanceConfigError";
  }
}

/**
 * Valida a configuração na carga do app e falha cedo (o build quebra). A mensagem de erro traz
 * só o caminho de cada campo inválido, nunca o valor.
 */
export function parseInstanceConfig(raw: unknown): Readonly<z.infer<typeof instanceConfigSchema>> {
  const result = instanceConfigSchema.safeParse(raw);
  if (!result.success) {
    const fields = [...new Set(result.error.issues.map((issue) => issue.path.join(".") || "(raiz)"))];
    throw new InstanceConfigError(fields);
  }
  return Object.freeze(result.data);
}
