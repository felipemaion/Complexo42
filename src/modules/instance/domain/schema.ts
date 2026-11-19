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
  /** Identificador estável da casa (casa com a unidade do eixo `house`, #46). */
  id: slug,
  name: text,
  /** Descrição curta exibida na escolha da casa. */
  description: text,
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
  houses: z
    .array(houseSchema)
    .min(1)
    .superRefine((houses, ctx) => {
      const seen = new Set<string>();
      houses.forEach((house, index) => {
        if (seen.has(house.id)) {
          ctx.addIssue({ code: "custom", message: "id de casa repetido", path: [index, "id"] });
        }
        seen.add(house.id);
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
