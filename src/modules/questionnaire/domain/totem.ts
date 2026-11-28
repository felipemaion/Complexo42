import { totemCodesOf, type QuestionnaireConfig } from "./schema";

/*
 * Nomes dos totens (#193). Puro: só texto. O totem é interno (só a coordenação e os delegados o
 * veem); a tela mostra "Nome (CÓDIGO)". Os nomes vêm do mapa `totemLabels` do questionário.
 */

/** Os quatro códigos de totem, na ordem aa, ab, ba, bb dos polos dos eixos 3 e 4. */
export function totemCodes(config: QuestionnaireConfig): string[] {
  return totemCodesOf(config.axes.totem1.letters, config.axes.totem2.letters);
}

/** "Nome (CÓDIGO)"; código sem nome no mapa vira só o código, e sem totem, vazio. */
export function totemLabel(config: QuestionnaireConfig, code: string | null): string {
  if (code === null || code === "") return "";
  const label = config.totemLabels[code];
  return label ? `${label.name} (${code})` : code;
}

/** Só o nome do totem (alt da medalha); código sem nome no mapa vira o código, e sem totem, vazio. */
export function totemName(config: QuestionnaireConfig, code: string | null): string {
  if (code === null || code === "") return "";
  return config.totemLabels[code]?.name ?? code;
}
