// Monograma do cabeçalho: até 3 caracteres, a partir do nome curto da instância (config/).
const maxInitialsChars = 3;

export function brandInitials(shortName: string): string {
  const words = shortName.trim().split(/\s+/).filter((word) => word.length > 0);
  const [firstWord] = words;
  if (firstWord === undefined) return "?";

  // Várias palavras: a inicial de cada uma.
  if (words.length >= 2) {
    return words
      .slice(0, maxInitialsChars)
      .map((word) => word.charAt(0).toUpperCase())
      .join("");
  }

  // Uma palavra terminada em número (ex.: "Complexo42" → "C42"): inicial + dígitos finais.
  const withTrailingDigits = /^(\D)\D*(\d+)$/.exec(firstWord);
  if (withTrailingDigits?.[1] !== undefined && withTrailingDigits[2] !== undefined) {
    return `${withTrailingDigits[1].toUpperCase()}${withTrailingDigits[2]}`.slice(0, maxInitialsChars);
  }

  const letters = firstWord.slice(0, maxInitialsChars);
  return letters.charAt(0).toUpperCase() + letters.slice(1).toLowerCase();
}
