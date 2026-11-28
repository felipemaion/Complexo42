/**
 * WhatsApp brasileiro digitado → E.164 (issue #12). Puro: roda no navegador (máscara) e no
 * servidor (validação, que é a que vale). Só celular: DDD válido + 9 dígitos começando por 9.
 *
 * Aceita o número como as pessoas costumam escrever: com ou sem parênteses, espaço, hífen,
 * ponto, `+55`, `55` ou o `0` antes do DDD.
 */

/** DDDs em uso no Brasil (plano de numeração da Anatel). */
const DDDS: ReadonlySet<string> = new Set(
  [
    "11 12 13 14 15 16 17 18 19",
    "21 22 24 27 28",
    "31 32 33 34 35 37 38",
    "41 42 43 44 45 46 47 48 49",
    "51 53 54 55",
    "61 62 63 64 65 66 67 68 69",
    "71 73 74 75 77 79",
    "81 82 83 84 85 86 87 88 89",
    "91 92 93 94 95 96 97 98 99",
  ]
    .join(" ")
    .split(" "),
);

/** Teto do que a pessoa digita (com máscara e `+55`); o resto é ignorado. */
export const whatsappInputMaxLength = 24;

/** Os 11 dígitos nacionais (DDD + celular), tirando `+55`/`55` e o `0` de longa distância. */
function nationalDigits(raw: string): string {
  let digits = raw.replace(/\D/g, "");
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith("55")) digits = digits.slice(2);
  if (digits.length === 12 && digits.startsWith("0")) digits = digits.slice(1);
  return digits;
}

/** `+55DDD9XXXXXXXX` ou `null` se não for um celular brasileiro válido. */
export function brazilianWhatsappToE164(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > whatsappInputMaxLength) return null;
  if (/[^\d\s()+.-]/.test(raw)) return null;
  const digits = nationalDigits(raw);
  if (digits.length !== 11 || !DDDS.has(digits.slice(0, 2)) || digits[2] !== "9") return null;
  return `+55${digits}`;
}

/**
 * Máscara enquanto a pessoa digita: `(11) 91234-5678`. Também mostra um E.164 já salvo
 * (`+5511912345678`) no mesmo formato. Nunca inventa dígito; só arruma os que existem.
 */
export function formatBrazilianWhatsapp(raw: string): string {
  let digits = raw.replace(/\D/g, "");
  if (raw.trim().startsWith("+55") || (digits.length > 11 && digits.startsWith("55"))) digits = digits.slice(2);
  else if (digits.length > 11 && digits.startsWith("0")) digits = digits.slice(1);
  digits = digits.slice(0, 11);
  if (digits.length === 0) return "";
  if (digits.length <= 2) return `(${digits}`;
  const ddd = digits.slice(0, 2);
  const rest = digits.slice(2);
  if (rest.length <= 5) return `(${ddd}) ${rest}`;
  return `(${ddd}) ${rest.slice(0, 5)}-${rest.slice(5)}`;
}

/**
 * Link `wa.me` para um WhatsApp já guardado (E.164). Só dígitos, e só se o número passa na mesma regra do cadastro
 * (celular brasileiro): qualquer outra coisa vira `null`, nunca um link montado com texto livre.
 */
export function whatsappLink(stored: unknown): string | null {
  const e164 = brazilianWhatsappToE164(stored);
  return e164 === null ? null : `https://wa.me/${e164.slice(1)}`;
}
