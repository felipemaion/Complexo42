// Política da senha (ADR 0018 §2). Pura, sem rede nem React: o servidor a confere antes de chamar
// o Auth e a tela a usa no medidor, então as duas dizem sempre a mesma coisa. A checagem de senha
// vazada (HIBP) fica no GoTrue; esta lista local vale mesmo com a API fora do ar.

/** Mínimo em caracteres; o GoTrue usa o mesmo valor (GOTRUE_PASSWORD_MIN_LENGTH). */
export const passwordMinLengthChars = 12;
/** O bcrypt só lê os 72 primeiros bytes: acima disso, duas senhas diferentes valeriam igual. */
export const passwordMaxLengthBytes = 72;
/** A partir daqui o medidor da tela mostra "forte". */
const strongLengthChars = 16;

export type PasswordProblem = "too_short" | "too_long" | "common";
export type PasswordStrength = "weak" | "ok" | "strong";

// Senhas muito usadas (listas públicas de vazamentos, em português e inglês), montadas como
// raiz + final comum, e sequências de dígitos. Comparação em minúsculas; a política já exige 12+.
const weakRoots = ["senha", "senhasenha", "minhasenha", "mudar", "password", "passwordpassword", "qwerty", "qwertyuiop", "qwertyuiopasdf", "asdfghjkl", "1q2w3e4r5t6y", "abcdefghijkl", "abc", "iloveyou", "brasil", "brasilbrasil"];
const weakTails = ["", "12", "123", "1234", "12345", "123456", "12345678", "123456789"];
const weakEntries: ReadonlySet<string> = new Set(weakRoots.flatMap((root) => weakTails.map((tail) => root + tail)));
const digitRun = "0123456789".repeat(2);

// Senhas comuns mudam só o fim ("senhasenha" + "1234"): compara também sem números e pontuação finais.
const weakBases: ReadonlySet<string> = new Set(["senhasenha", "passwordpassword", "minhasenha", "qwertyuiop", "brasilbrasil", "abcdefghijkl"]);

/** Um trecho de até 4 caracteres que se repete até o fim ("aaaa…", "abcabc…"). */
function isShortPatternRepeated(value: string): boolean {
  for (let size = 1; size <= 4; size++) {
    if (value.length < size * 3) break;
    if (value === value.slice(0, size).repeat(Math.ceil(value.length / size)).slice(0, value.length)) return true;
  }
  return false;
}

/** Dígitos em sequência, crescente ou decrescente ("123456789012", "987654321098"). */
function isDigitSequence(value: string): boolean {
  return digitRun.includes(value) || [...digitRun].reverse().join("").includes(value);
}

function isCommon(password: string): boolean {
  const lower = password.toLowerCase();
  if (weakEntries.has(lower) || isShortPatternRepeated(lower) || isDigitSequence(lower)) return true;
  return weakBases.has(lower.replace(/[\d\W_]+$/u, ""));
}

/** O problema da senha ou null se ela vale. Entrada que não é texto falha fechado (`too_short`). */
export function checkPassword(password: unknown): PasswordProblem | null {
  if (typeof password !== "string") return "too_short";
  if ([...password].length < passwordMinLengthChars) return "too_short";
  if (new TextEncoder().encode(password).length > passwordMaxLengthBytes) return "too_long";
  return isCommon(password) ? "common" : null;
}

export function passwordStrength(password: string): PasswordStrength {
  if (checkPassword(password) !== null) return "weak";
  return [...password].length >= strongLengthChars ? "strong" : "ok";
}
