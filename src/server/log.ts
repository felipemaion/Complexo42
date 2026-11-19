// Log da aplicação em JSON (uma linha por evento), no stdout e em <LOG_DIR>/app.log (#80).
// R11: nada de nome, WhatsApp ou e-mail. Campos com nome suspeito viram "[redacted]" e
// e-mails ou telefones dentro de textos são mascarados, como segunda barreira.
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export type LogLevel = "info" | "warn" | "error";
type Fields = Record<string, unknown>;

const SENSITIVE_KEY = /name|nome|whats|phone|telefone|celular|e-?mail|password|senha|secret|token|key|cookie|authorization/i;
const EMAIL = /[^\s@"]+@[^\s@"]+\.[^\s@"]+/g;
// Bordas de palavra nas duas pontas: não mascara dígitos dentro de hash de commit ou id.
const PHONE = /(?<!\w)\+?\(?\d[\d\s().-]{8,}\d(?!\w)/g;
const REDACTED = "[redacted]";

function scrub(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return value.replace(EMAIL, REDACTED).replace(PHONE, REDACTED);
  if (typeof value !== "object" || value === null) return value;
  if (depth > 4) return REDACTED;
  if (Array.isArray(value)) return value.map((v) => scrub(v, depth + 1));
  return Object.fromEntries(
    Object.entries(value).map(([k, v]) => [k, SENSITIVE_KEY.test(k) ? REDACTED : scrub(v, depth + 1)]),
  );
}

export function formatEntry(level: LogLevel, event: string, fields: Fields = {}, now = new Date()): string {
  return JSON.stringify({ ...(scrub(fields) as Fields), ts: now.toISOString(), level, event: scrub(event) });
}

export type Logger = Record<LogLevel, (event: string, fields?: Fields) => void>;

export function createLogger(dir: string | undefined, out: (line: string) => void = (l) => process.stdout.write(l)): Logger {
  let file = dir ? join(dir, "app.log") : undefined;
  let ready = false;
  const write = (level: LogLevel, event: string, fields?: Fields) => {
    const line = formatEntry(level, event, fields) + "\n";
    out(line);
    if (!file) return;
    try {
      if (!ready) mkdirSync(dir as string, { recursive: true });
      ready = true;
      appendFileSync(file, line);
    } catch {
      // Diretório sem permissão ou só leitura: segue só no stdout, avisando uma vez.
      file = undefined;
      out(formatEntry("warn", "log_file_disabled", { reason: "not_writable" }) + "\n");
    }
  };
  return { info: (e, f) => write("info", e, f), warn: (e, f) => write("warn", e, f), error: (e, f) => write("error", e, f) };
}

export const log: Logger = createLogger(process.env.LOG_DIR || "data/logs");
