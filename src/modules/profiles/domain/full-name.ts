/**
 * Nome completo (issue #312): ao menos duas palavras com 2 ou mais letras cada. Dá para
 * "Ana Lu" e "Maria da Silva" (partículas e iniciais extras não contam, mas não atrapalham) e
 * recusa lixo como "a b", "1 2", "- -" e "😀 😀". Pura: sem banco nem rede.
 */
const INVISIBLE = /\p{Cf}/gu;
const LETTER = /\p{L}/gu;
const minLettersPerWord = 2;
const minWords = 2;

/** Tira caracteres invisíveis (ZWSP, ZWJ, BOM...), que fariam "Ana ​" parecer duas palavras. */
export function stripInvisible(value: string): string {
  return value.replace(INVISIBLE, "");
}

export function isFullName(raw: string): boolean {
  const words = stripInvisible(raw).split(/\s+/);
  const real = words.filter((word) => (word.match(LETTER) ?? []).length >= minLettersPerWord);
  return real.length >= minWords;
}

/**
 * Convite no perfil e no /inicio para quem foi cadastrado com uma palavra só. Nome vazio é nome
 * que não pôde ser lido (decifra falhou): não é caso de pedir sobrenome.
 */
export function needsFullNameNotice(displayName: string): boolean {
  return displayName.trim() !== "" && !isFullName(displayName);
}
