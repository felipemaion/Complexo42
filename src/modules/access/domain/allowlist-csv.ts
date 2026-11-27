/**
 * Leitura do CSV da lista de autorizados (ADR 0008 §1, issue #26). Função pura: recebe o texto
 * do arquivo e devolve os e-mails normalizados, sem duplicados, para o servidor calcular o
 * HMAC e descartar o texto. Nada aqui loga, e os erros nunca citam o conteúdo das linhas, só
 * os números delas (R11).
 *
 * Formato aceito: qualquer planilha exportada em CSV (vírgula, ponto e vírgula ou tabulação),
 * com ou sem cabeçalho. Em cada linha vale a primeira célula com "@"; as outras colunas (nome,
 * telefone) são ignoradas e nunca saem desta função.
 */

/**
 * Teto por importação. 1,5 MB cabe em uma server action de 2 MB (next.config.ts) e comporta
 * cerca de 35 mil e-mails, o que basta para a lista de uma vez; listas maiores vão em partes.
 * O banco aceita até 50 mil HMACs por chamada (`import_allowlist`): o limite daqui é menor.
 */
export const allowlistLimits = { maxEmails: 35_000, maxBytes: 1.5 * 1024 * 1024 } as const;

export type AllowlistImportErrorCode = "empty" | "too_large" | "too_many" | "invalid_email";

/** Erro da importação. A mensagem é fixa: nunca traz e-mail nem trecho do arquivo. */
export class AllowlistImportError extends Error {
  constructor(readonly code: AllowlistImportErrorCode) {
    super(
      {
        empty: "O arquivo não tem nenhum e-mail válido.",
        too_large: "O arquivo passa do tamanho máximo.",
        too_many: `O arquivo passa de ${allowlistLimits.maxEmails} e-mails.`,
        invalid_email: "O e-mail não tem um formato válido.",
      }[code],
    );
    this.name = "AllowlistImportError";
  }
}

export type ParsedAllowlist = {
  /** E-mails em minúsculas e sem espaços nas pontas, sem repetição. */
  emails: string[];
  /** Linhas (contando a partir de 1) que têm "@" mas não um e-mail válido, ou nenhum e-mail. */
  invalidLines: number[];
};

// A mesma regra de `normalizeEmail` (src/server/crypto): o HMAC é calculado sobre este texto.
const EMAIL = /^[^\s@]+@[^\s@]+$/;
const MAX_EMAIL_LENGTH = 254;

/** Minúsculas e sem espaços nas pontas; null se não for um e-mail. */
export function normalizeAllowlistEmail(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  return normalized.length <= MAX_EMAIL_LENGTH && EMAIL.test(normalized) ? normalized : null;
}

function cellsOf(line: string): string[] {
  return line.split(/[,;\t]/).map((cell) => cell.trim().replace(/^"(.*)"$/, "$1").trim());
}

export function parseAllowlistCsv(text: string): ParsedAllowlist {
  if (new TextEncoder().encode(text).length > allowlistLimits.maxBytes) {
    throw new AllowlistImportError("too_large");
  }

  const emails = new Set<string>();
  const invalidLines: number[] = [];
  let sawContent = false;

  text
    .replace(/^﻿/, "")
    .split(/\r\n|\r|\n/)
    .forEach((line, index) => {
      if (line.trim() === "") return;
      const isFirstContent = !sawContent;
      sawContent = true;

      const candidate = cellsOf(line).find((cell) => cell.includes("@"));
      if (candidate === undefined) {
        // A primeira linha sem "@" é o cabeçalho; depois disso, é linha sem e-mail.
        if (!isFirstContent) invalidLines.push(index + 1);
        return;
      }
      const email = normalizeAllowlistEmail(candidate);
      if (email === null) invalidLines.push(index + 1);
      else emails.add(email);
    });

  if (emails.size === 0) throw new AllowlistImportError("empty");
  if (emails.size > allowlistLimits.maxEmails) throw new AllowlistImportError("too_many");
  return { emails: [...emails], invalidLines };
}
