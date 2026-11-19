import { chmodSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createLogger, formatEntry } from "./log";

const dirs: string[] = [];
const tempDir = () => {
  const d = mkdtempSync(join(tmpdir(), "log-test-"));
  dirs.push(d);
  return d;
};
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

describe("formatEntry", () => {
  it("gera uma linha JSON com ts, level e event", () => {
    const line = formatEntry("info", "boot", { port: 3000 }, new Date("2026-01-01T00:00:00Z"));
    expect(JSON.parse(line)).toEqual({ ts: "2026-01-01T00:00:00.000Z", level: "info", event: "boot", port: 3000 });
  });

  it("não deixa passar nome, WhatsApp nem e-mail (R11)", () => {
    const line = formatEntry("warn", "x", {
      fullName: "Fulana de Tal",
      whatsapp: "+55 11 91234-5678",
      detail: { email: "a@b.com", note: "contato fulana@exemplo.com ou (11) 91234-5678" },
    });
    expect(line).not.toMatch(/Fulana|91234|@b\.com|exemplo\.com/);
    expect(JSON.parse(line).detail.note).toBe("contato [redacted] ou [redacted]");
  });

  it("preserva hash de commit com sequência de dígitos", () => {
    const commit = "bd0c61c85d26bea040902d4bbde853099127558b";
    expect(JSON.parse(formatEntry("info", "boot", { commit })).commit).toBe(commit);
  });
});

describe("createLogger", () => {
  it("escreve no stdout e no arquivo app.log", () => {
    const dir = join(tempDir(), "logs");
    const out: string[] = [];
    createLogger(dir, (l) => out.push(l)).error("db_down", { reason: "timeout" });
    expect(out).toHaveLength(1);
    expect(readFileSync(join(dir, "app.log"), "utf8")).toBe(out[0]);
  });

  it("diretório sem permissão: segue só no stdout e avisa uma vez", () => {
    const dir = tempDir();
    chmodSync(dir, 0o500);
    const out: string[] = [];
    const logger = createLogger(join(dir, "logs"), (l) => out.push(l));
    logger.info("a");
    logger.info("b");
    chmodSync(dir, 0o700);
    expect(out.map((l) => JSON.parse(l).event)).toEqual(["a", "log_file_disabled", "b"]);
  });
});
