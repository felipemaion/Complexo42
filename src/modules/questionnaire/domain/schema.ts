import { z } from "zod";

/*
 * Formato do questionário das casas (ADR 0008 §2.1, #91). Este arquivo é puro: roda no
 * servidor (validação na subida) e no navegador (a pontuação acontece no dispositivo).
 *
 * O texto real das perguntas não entra no repositório: em desenvolvimento usa-se
 * `config/questionnaire.example.json`, fictício; em produção, o arquivo de QUESTIONNAIRE_PATH.
 */

/** Eixos do modelo de Keirsey, cada um com seus dois polos. */
export const axes = {
  EI: ["E", "I"],
  SN: ["S", "N"],
  TF: ["T", "F"],
  JP: ["J", "P"],
} as const;

export type Axis = keyof typeof axes;
export type Pole = (typeof axes)[Axis][number];

export const axisKeys = ["EI", "SN", "TF", "JP"] as const satisfies readonly Axis[];
export const poles = ["E", "I", "S", "N", "T", "F", "J", "P"] as const satisfies readonly Pole[];

/** Temperamentos de Keirsey: S se divide por J/P, N por T/F. E/I não define o temperamento. */
export const temperaments = ["NF", "SJ", "NT", "SP"] as const;
export type Temperament = (typeof temperaments)[number];

/**
 * Regra de desempate padrão: em empate num eixo, vence o polo indicado aqui. Segue a convenção
 * usual dos inventários tipológicos (I, N, F, P) até o stakeholder definir outra (pergunta 75).
 */
export const defaultTieBreak = { EI: "I", SN: "N", TF: "F", JP: "P" } as const satisfies Record<Axis, Pole>;

const text = z.string().trim().min(1);
const slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "id em minúsculas, números e hífens");
const pole = z.enum(poles);

const alternativeSchema = z.strictObject({
  text,
  /** Polo que esta alternativa marca no eixo do item. */
  pole,
});

const itemSchema = z
  .strictObject({
    id: slug,
    text,
    axis: z.enum(axisKeys),
    a: alternativeSchema,
    b: alternativeSchema,
  })
  .superRefine((item, ctx) => {
    const allowed: readonly Pole[] = axes[item.axis];
    for (const key of ["a", "b"] as const) {
      if (!allowed.includes(item[key].pole)) {
        ctx.addIssue({ code: "custom", message: "polo não pertence ao eixo do item", path: [key, "pole"] });
      }
    }
    if (item.a.pole === item.b.pole) {
      ctx.addIssue({ code: "custom", message: "as alternativas precisam marcar polos opostos", path: ["b", "pole"] });
    }
  });

const tieBreakSchema = z.strictObject({
  EI: z.enum(axes.EI),
  SN: z.enum(axes.SN),
  TF: z.enum(axes.TF),
  JP: z.enum(axes.JP),
});

const houseByTemperamentShape = Object.fromEntries(temperaments.map((t) => [t, slug])) as Record<
  Temperament,
  typeof slug
>;

export const questionnaireSchema = z
  .strictObject({
    /** Versão do questionário (identifica a chave de correção usada). */
    version: text,
    /** Versão do termo de consentimento, registrada junto com o aceite. */
    consentTermVersion: text,
    /** Regra de desempate por eixo: o polo que vence em caso de empate. */
    tieBreak: tieBreakSchema.default(defaultTieBreak),
    /** Casa sugerida para cada temperamento (id de uma casa de config/instance.ts). */
    houseByTemperament: z.strictObject(houseByTemperamentShape),
    items: z.array(itemSchema).min(1),
  })
  .superRefine((config, ctx) => {
    const seen = new Set<string>();
    config.items.forEach((item, index) => {
      if (seen.has(item.id)) ctx.addIssue({ code: "custom", message: "id de item repetido", path: ["items", index, "id"] });
      seen.add(item.id);
    });
    // E/I é opcional (pergunta 77); os outros três eixos definem o temperamento.
    for (const axis of ["SN", "TF", "JP"] as const) {
      if (!config.items.some((item) => item.axis === axis)) {
        ctx.addIssue({ code: "custom", message: `nenhum item no eixo ${axis}`, path: ["items"] });
      }
    }
  });

export type QuestionnaireConfig = z.infer<typeof questionnaireSchema>;
export type QuestionnaireItem = QuestionnaireConfig["items"][number];

/** Erro de configuração do questionário: a mensagem cita só os campos, nunca os valores. */
export class QuestionnaireConfigError extends Error {
  constructor(readonly fields: string[]) {
    super(`Questionário inválido: ${fields.join(", ")}`);
    this.name = "QuestionnaireConfigError";
  }
}

/**
 * Valida o questionário e confere que cada casa do mapa existe na instância. Falha com a lista
 * de campos inválidos, sem o texto das perguntas.
 */
export function parseQuestionnaire(raw: unknown, houseIds: readonly string[]): Readonly<QuestionnaireConfig> {
  const result = questionnaireSchema.safeParse(raw);
  if (!result.success) {
    throw new QuestionnaireConfigError([
      ...new Set(result.error.issues.map((issue) => issue.path.join(".") || "(raiz)")),
    ]);
  }
  const unknown = temperaments
    .filter((t) => !houseIds.includes(result.data.houseByTemperament[t]))
    .map((t) => `houseByTemperament.${t}`);
  if (unknown.length > 0) throw new QuestionnaireConfigError(unknown);
  return Object.freeze(result.data);
}
