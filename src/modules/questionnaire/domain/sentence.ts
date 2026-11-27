/*
 * Frases da escala de intensidade (#190). Puro: só texto. O texto das alternativas vem do
 * questionário como foi escrito (em minúsculas, terminando em ";" ou sem pontuação); na tela, toda
 * frase aparece com a primeira letra em maiúscula e terminando em pontuação. A normalização é só de
 * exibição: o arquivo do questionário não muda.
 */

import { answerValues } from "./score";

const finalPunctuation = /[.!?…]$/;
// Aspas e parênteses de abertura que podem vir antes da primeira letra.
const opening = /^([“"'‘«(\[]*)(\p{L})/u;

/** Primeira letra em maiúscula (depois de aspas ou parênteses de abertura); número no começo fica como está. */
function capitalize(text: string): string {
  return text.replace(opening, (_all, before: string, letter: string) => `${before}${letter.toLocaleUpperCase("pt-BR")}`);
}

/** Termina em pontuação: ";", "," e ":" finais viram ".", e sem pontuação acrescenta ".". */
function terminate(text: string): string {
  const trimmed = text.trim().replace(/\s+([;,:.!?…])$/, "$1");
  if (trimmed === "") return "";
  if (finalPunctuation.test(trimmed)) return trimmed;
  return `${trimmed.replace(/[;,:]$/, "")}.`;
}

/** Frase para exibir: primeira letra em maiúscula e pontuação no fim. Vazio continua vazio. */
export function toDisplaySentence(text: string): string {
  return capitalize(terminate(text));
}

/**
 * Frase da posição escolhida na escala: "Intensidade: texto da alternativa." A intensidade também
 * começa com maiúscula; o texto da alternativa fica como está, no meio da frase (só a pontuação final
 * é normalizada). Sem texto de alternativa, só a intensidade.
 */
export function intensitySentence(intensity: string, alternativeText: string): string {
  const label = capitalize(intensity.trim().replace(/[:;,.]$/, ""));
  const body = terminate(alternativeText);
  return body === "" ? `${label}.` : `${label}: ${body}`;
}

/**
 * A resposta de um item como frase ("Totalmente: …"), para a coordenação ler. Negativo é a alternativa
 * a, positivo a b. Valor fora da escala: `null`.
 */
export function answerSentence(
  item: { a: { text: string }; b: { text: string } },
  value: number,
  intensities: readonly [string, string, string, string, string, string],
): string | null {
  const index = (answerValues as readonly number[]).indexOf(value);
  if (index === -1) return null;
  return intensitySentence(intensities[index]!, index < 3 ? item.a.text : item.b.text);
}
