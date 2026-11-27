import { z } from "zod";

/*
 * Formato do questionário das casas (ADR 0012, #172; antes ADR 0008 §2.1, #91). Este arquivo é
 * puro: roda no servidor (validação na subida) e no navegador (a pontuação acontece no
 * dispositivo).
 *
 * Quatro eixos, cada um com a sua lista de itens (o config diz quais itens contam para qual
 * eixo, não a ordem de apresentação). Em todo item a alternativa "a" marca o polo "a" do eixo
 * e a "b" marca o polo "b". Os eixos 1 e 2 definem a casa; os eixos 3 e 4, o totem.
 *
 * O texto real das perguntas e a chave real não entram no repositório: em desenvolvimento usa-se
 * `config/questionnaire.example.json`, fictício; em produção, o arquivo de QUESTIONNAIRE_PATH.
 */

/** Eixo 1 e eixo 2 definem a casa; totem1 e totem2 (eixos 3 e 4) definem o totem. */
export const axisKeys = ["house1", "house2", "totem1", "totem2"] as const;
export type Axis = (typeof axisKeys)[number];

export const poles = ["a", "b"] as const;
export type Pole = (typeof poles)[number];

const text = z.string().trim().min(1);
const slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "id em minúsculas, números e hífens");
const totemLetter = z.string().regex(/^[A-Z]$/, "uma letra maiúscula");

const alternativeSchema = z.strictObject({ text });

const itemSchema = z.strictObject({
  id: slug,
  text,
  a: alternativeSchema,
  b: alternativeSchema,
});

const axisShape = {
  /** Ids dos itens que contam para este eixo. */
  itemIds: z.array(slug).min(1),
  /**
   * Itens que desempatam o eixo (subconjunto de `itemIds`, indicado pelo stakeholder). Sem eles,
   * o empate deixa o resultado inconclusivo. Vale por eixo.
   */
  tieBreakItems: z.array(slug).default([]),
};
const houseAxisSchema = z.strictObject(axisShape);
const totemAxisSchema = z.strictObject({
  ...axisShape,
  /** Letra que cada polo acrescenta ao totem. */
  letters: z.strictObject({ a: totemLetter, b: totemLetter }),
});

const houseByPolesShape = { aa: slug, ab: slug, ba: slug, bb: slug };

export const questionnaireSchema = z
  .strictObject({
    /** Versão do questionário (identifica a chave de correção usada). */
    version: text,
    /** Versão do termo de consentimento, registrada junto com o aceite. */
    consentTermVersion: text,
    /**
     * Texto do termo de consentimento, mostrado antes da primeira pergunta (#76). Como as
     * perguntas, o texto real fica fora do repositório (no arquivo de QUESTIONNAIRE_PATH).
     */
    consentTerm: text,
    /** Itens na ordem em que aparecem para a pessoa. */
    items: z.array(itemSchema).min(1),
    axes: z.strictObject({
      house1: houseAxisSchema,
      house2: houseAxisSchema,
      totem1: totemAxisSchema,
      totem2: totemAxisSchema,
    }),
    /**
     * Casa sugerida para cada par de polos (eixo 1, eixo 2): `ab` é "a" no eixo 1 e "b" no eixo 2.
     * Id de uma casa de config/instance.ts; as quatro casas são distintas.
     */
    houseByPoles: z.strictObject(houseByPolesShape),
  })
  .superRefine((config, ctx) => {
    const issue = (message: string, path: (string | number)[]) => ctx.addIssue({ code: "custom", message, path });
    const itemIds = new Set<string>();
    config.items.forEach((item, index) => {
      if (itemIds.has(item.id)) issue("id de item repetido", ["items", index, "id"]);
      itemIds.add(item.id);
    });

    const axisOfItem = new Map<string, Axis>();
    for (const axis of axisKeys) {
      const { itemIds: ids, tieBreakItems } = config.axes[axis];
      ids.forEach((id, index) => {
        if (!itemIds.has(id)) return issue("item inexistente", ["axes", axis, "itemIds", index]);
        if (axisOfItem.has(id)) return issue("item em mais de um eixo (ou repetido no eixo)", ["axes", axis, "itemIds", index]);
        axisOfItem.set(id, axis);
      });
      tieBreakItems.forEach((id, index) => {
        if (!ids.includes(id)) issue("item de desempate fora do eixo", ["axes", axis, "tieBreakItems", index]);
      });
    }
    config.items.forEach((item, index) => {
      if (!axisOfItem.has(item.id)) issue("item sem eixo", ["items", index, "id"]);
    });

    for (const axis of ["totem1", "totem2"] as const) {
      const { a, b } = config.axes[axis].letters;
      if (a === b) issue("os dois polos do totem precisam de letras diferentes", ["axes", axis, "letters"]);
    }
    if (new Set(Object.values(config.houseByPoles)).size !== 4) issue("as quatro casas precisam ser distintas", ["houseByPoles"]);
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
  const unknown = (Object.keys(houseByPolesShape) as (keyof typeof houseByPolesShape)[])
    .filter((poles) => !houseIds.includes(result.data.houseByPoles[poles]))
    .map((poles) => `houseByPoles.${poles}`);
  if (unknown.length > 0) throw new QuestionnaireConfigError(unknown);
  return Object.freeze(result.data);
}
