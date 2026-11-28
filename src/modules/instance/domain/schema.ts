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
  /**
   * Cor da casa no gráfico de aranha (#201): uma para o tema claro e outra, mais clara, para o
   * escuro (CSS `light-dark()`); cada uma com contraste de pelo menos 3:1 sobre o fundo do tema.
   */
  color: z.strictObject({ light: hexColor, dark: hexColor }),
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
    /** Botão "Sair" da espera (#195): encerra a sessão para trocar de conta. */
    signOutButton: text,
  }),
  /** Textos do login (#9). Botões grandes e nada escondido (pedido do stakeholder). */
  auth: z.strictObject({
    title: text,
    intro: text,
    googleButton: text,
    emailLabel: text,
    emailButton: text,
    /** Senha opcional (ADR 0018): campo e botões de /entrar e o aviso da recuperação. */
    passwordLabel: text,
    passwordButton: text,
    recoverButton: text,
    recoverySent: text,
    emailNeedsScript: text,
    emailSent: text,
    signedOut: text,
    signOutButton: text,
    signedInTitle: text,
    signedInMessage: text,
    /** Rótulo antes do e-mail mascarado de quem está logado (ex.: "Conectado como"). */
    connectedAs: text,
    navLabel: text,
    navHome: text,
    navBack: text,
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
      legacy_link: text,
      /** Senha errada, e-mail sem conta ou sem senha: a MESMA frase (ADR 0018 §3). */
      bad_credentials: text,
      session_expired: text,
    }),
  }),
  /** Senha opcional (ADR 0018): página /senha e a seção do perfil. */
  password: z.strictObject({
    title: text,
    homeLink: text,
    intro: text,
    rules: text,
    googleMessage: text,
    currentLabel: text,
    currentHint: text,
    newLabel: text,
    confirmLabel: text,
    saveButton: text,
    removeButton: text,
    removeHint: text,
    sectionTitle: text,
    meterLabel: text,
    strength: z.strictObject({ weak: text, ok: text, strong: text }),
    status: z.strictObject({ saved: text, removed: text }),
    /** Um texto por problema; a tela só mostra códigos conhecidos. */
    errors: z.strictObject({
      too_short: text,
      too_long: text,
      common: text,
      pwned: text,
      mismatch: text,
      current_required: text,
      current_wrong: text,
      reauth_needed: text,
      same: text,
      rate_limited: text,
      unavailable: text,
      failed: text,
    }),
  }),
  /** Formulário do perfil (#12): nome, WhatsApp e localização. Linguagem simples. */
  emails: z.strictObject({
    expires: text,
    fallback: text,
    footer: text,
    templates: z.strictObject(
      Object.fromEntries(
        ["magic-link", "confirmation", "recovery", "invite", "email-change"].map((kind) => [
          kind,
          z.strictObject({ subject: text, heading: text, intro: text, button: text }),
        ]),
      ) as Record<"magic-link" | "confirmation" | "recovery" | "invite" | "email-change", z.ZodObject<{ subject: typeof text; heading: typeof text; intro: typeof text; button: typeof text }, z.core.$strict>>,
    ),
  }),
  profile: z.strictObject({
    title: text,
    intro: text,
    nameLabel: text,
    nameHint: text,
    whatsappLabel: text,
    whatsappHint: text,
    /** Localização em três passos (#175): estado, cidade (com busca) e distrito. */
    stateLabel: text,
    statePlaceholder: text,
    municipalitySearchLabel: text,
    municipalitySearchHint: text,
    /** A busca não achou cidade nenhuma no estado. */
    municipalityNoMatch: text,
    municipalityLabel: text,
    municipalityPlaceholder: text,
    /** Aviso enquanto a lista carrega, e se a carga falhar. */
    localitiesLoading: text,
    localitiesFailed: text,
    districtLabel: text,
    districtHint: text,
    /** Opção vazia do distrito (ele é opcional). */
    districtNone: text,
    /** Bairro (#179): texto livre, opcional. */
    neighborhoodLabel: text,
    neighborhoodHint: text,
    /** Bairro guardado que não abriu: aviso de que continua guardado e o botão para trocá-lo. */
    neighborhoodUnreadable: text,
    replaceNeighborhood: text,
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
      neighborhood: text,
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
    activitiesTitle: text,
    consentTitle: text,
    consentAccept: text,
    /** Recusar o termo leva à escolha direta (join_method = self). */
    consentDecline: text,
    /** Progresso do questionário, com `{current}` e `{total}` (ex.: "{current} de {total}"). */
    progress: text.refine((v) => v.includes("{current}") && v.includes("{total}"), "use {current} e {total}"),
    /** Botão de quem marca as duas alternativas (indecisão). */
    /**
     * Pergunta da escala de intensidade (leitor de tela) e a intensidade de cada um dos seis círculos,
     * da ponta "a" à ponta "b". A frase da posição é "intensidade: texto da alternativa".
     */
    scaleLegend: text,
    scaleIntensities: z.tuple([text, text, text, text, text, text]),
    nextButton: text,
    finishButton: text,
    /** Título do gráfico de aranha do perfil (eixos da casa). */
    chartTitle: text,
    /** Destaque da casa na legenda do gráfico (#201). */
    chartCurrentHouse: text,
    backButton: text,
    /** Título do resultado do questionário (a casa sugerida). */
    suggestedTitle: text,
    /** Título da apresentação de uma casa escolhida na lista. */
    chosenTitle: text,
    firstStepsTitle: text,
    videosTitle: text,
    acceptButton: text,
    chooseOtherButton: text,
    /** Comparação ao escolher outra casa (#240): mínimo de membros para o perfil médio e prazo do cache em memória. */
    // Piso de privacidade: o perfil médio só aparece com 10 membros ou mais, e o servidor guarda o agregado por 10 minutos ou mais.
    minAverageMembers: z.number().int().min(10),
    averageCacheSeconds: z.number().int().min(600),
    compare: z.strictObject({
      title: text,
      intro: text,
      suggestedBadge: text,
      /** Troca de casa depois da trava (#268): a casa em que a pessoa está hoje. */
      currentBadge: text,
      currentLabel: text,
      suggestedLabel: text,
      /** O token da comparação venceu (30 minutos): pede para recarregar a página. */
      expiredReload: text,
      selectedBadge: text,
      yourProfileLabel: text,
      chartTitle: text,
      averageLabel: text,
      averageNote: text,
      fewMembers: text,
      averageUnavailable: text,
      expectTitle: text,
      expectIntro: text,
      expectNone: text,
      expectUnavailable: text,
      loading: text,
      confirmButton: text,
      backButton: text,
    }),
    /** Enquanto o resultado é enviado ao servidor, logo depois da última pergunta. */
    submitting: text,
    /** Tela de quem já aceitou a casa. */
    acceptedTitle: text,
    /** Link da página inicial para a escolha da casa. */
    homeLink: text,
    /** Na página da pessoa, sem casa nem resultado (#203): convite para fazer o questionário. */
    inviteMessage: text,
    /** Limite de renovação com o tempo restante conhecido (#199); `{minutes}` é trocado na tela. */
    rateLimitedWait: text.refine((v) => v.includes("{minutes}"), "use {minutes}"),
    consentLockNotice: text,
    /** Aviso de tela (fora do termo): as respostas ficam guardadas cifradas, para a troca de casa. */
    consentStoredNotice: text,
    lockedUntilNotice: text.refine((v) => v.includes("{date}"), "use {date}"),
    changeHouseLink: text,
    /** Depois da casa aceita: o próximo passo é o perfil (via /inicio), ADR 0017. */
    continueLink: text,
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
      house_locked: text,
      house_conflict: text,
      /** Pedido de análise renovado há pouco (no máximo um por hora). */
      rate_limited: text,
      /** A Server Action rejeitou: o app foi atualizado ou a conexão caiu (#315). */
      app_updated: text,
      failed: text,
    }),
  }),
  /**
   * Telas da coordenação do questionário (#174, ADR 0014): resultados, casos para analisar e
   * delegações. `{name}`, `{count}`, `{first}`, `{second}` e `{code}` são trocados na tela.
   */
  questionnaireCoordination: z.strictObject({
    linkResults: text,
    linkQueue: text,
    linkDelegations: text,
    backLink: text,
    noName: text,
    results: z.strictObject({
      title: text,
      intro: text,
      houseFilterLabel: text,
      houseFilterAll: text,
      filterButton: text,
      empty: text,
      columnPerson: text,
      columnHouse: text,
      columnDate: text,
      openLink: text,
      truncated: text.refine((v) => v.includes("{count}"), "use {count}"),
      detailTitle: text.refine((v) => v.includes("{name}"), "use {name}"),
      houseLabel: text,
      totemLabel: text,
      totemPending: text,
      totemUndecided: text,
      dateLabel: text,
      chartTitle: text,
      /** Destaque da casa na legenda do gráfico (#201). */
      chartCurrentHouse: text,
      noScores: text,
      columnChosen: text,
      chosenNone: text,
      differsMark: text,
      changedByCoordination: text.refine((v) => v.includes("{date}"), "use {date}"),
      otherHouseFilter: text,
      chosenLabel: text,
      chosenDateLabel: text,
      changeHouseTitle: text,
      changeHouseLabel: text,
      changeHouseButton: text,
      changedNotice: text,
      unreadableOne: text,
      backLink: text,
    }),
    queue: z.strictObject({
      title: text,
      intro: text,
      empty: text,
      columnPerson: text,
      columnDate: text,
      columnAxes: text,
      kindTotem: text,
      legacyKey: text,
      legacyKeyNotice: text,
      openLink: text,
      truncated: text.refine((v) => v.includes("{count}"), "use {count}"),
      unreadableList: text.refine((v) => v.includes("{count}"), "use {count}"),
      caseTitle: text.refine((v) => v.includes("{name}"), "use {name}"),
      tiedAxesLabel: text,
      answersTitle: text,
      chartTitle: text,
      /** Destaque da casa na legenda do gráfico (#201). */
      chartCurrentHouse: text,
      resolveTitle: text,
      totemOnlyNotice: text.refine((v) => v.includes("{house}"), "use {house}"),
      houseLabel: text,
      totemLabel: text,
      totemOption: text.refine((v) => v.includes("{label}") && v.includes("{description}"), "use {label} e {description}"),
      resolveButton: text,
      resolvedNotice: text,
      unreadableOne: text,
      backLink: text,
    }),
    delegations: z.strictObject({
      title: text,
      intro: text,
      activeTitle: text,
      empty: text,
      columnManager: text,
      columnUnit: text,
      columnDate: text,
      revokeButton: text,
      grantTitle: text,
      managerLabel: text,
      grantButton: text,
      noCandidates: text,
      grantedNotice: text,
      revokedNotice: text,
    }),
    errors: z.strictObject({
      forbidden: text,
      invalid: text,
      not_found: text,
      exists: text,
      changed: text,
      failed: text,
    }),
  }),
  /**
   * Telas da coordenação (#26, ADR 0008 §1): envio da lista de autorizados e fila de espera.
   * `{count}`, `{lines}`, `{date}`, `{city}`, `{state}` e `{name}` são trocados na tela.
   */
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
      /** Autorizar um e-mail à mão (campo + botão). */
      addEmail: z.strictObject({
        title: text,
        label: text,
        hint: text,
        button: text,
        adding: text,
        added: text,
        already: text,
        errors: z.strictObject({ invalid_email: text, forbidden: text, rate_limited: text, failed: text }),
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
      incompleteProfile: text,
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
