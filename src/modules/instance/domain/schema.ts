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
      /** A casa não está disponível na região da pessoa. */
      unavailable: text,
      /** A pessoa já aceitou outra casa. */
      already_accepted: text,
      /** Cadastro incompleto ou acesso ainda não liberado. */
      not_active: text,
      /** O termo mudou enquanto a pessoa respondia: recarregar. */
      stale_consent: text,
      /** A pessoa ainda não está numa região (só no estado). */
      region_undefined: text,
      /** A coordenação encerrou a casa da pessoa: a volta é com ela. */
      removed_by_coordination: text,
      failed: text,
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
