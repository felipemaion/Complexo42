// Server action do envio da lista de autorizados (#26): limites antes de ler o arquivo, só
// HMACs para o banco, nenhum e-mail no log nem no estado devolvido, e cada recusa com a sua
// mensagem (o 42501 do banco vira "forbidden": a tela não é a segurança, o banco é).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { allowlistLimits } from "@/modules/access";

type Rpc = { fn: string; args: Record<string, unknown> };
const calls: Rpc[] = [];
let answer: { data: unknown; error: unknown } = { data: { received: 2, promoted: 1 }, error: null };
const client = {
  rpc: async (fn: string, args: Record<string, unknown>) => {
    calls.push({ fn, args });
    return answer;
  },
};
const logged: unknown[] = [];

vi.mock("@/server/auth/session", () => ({
  requireUserClient: async () => ({ user: { id: "0b6f2d4e-3c1a-4f8e-9d2b-7a5c6e1f0a93" }, client }),
}));
// HMAC de mentira, mas no formato real (64 hex) e sem nada do e-mail.
vi.mock(import("@/server/crypto"), async (importOriginal) => ({
  ...(await importOriginal()),
  emailBlindIndex: async (email: string) => {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(email.trim().toLowerCase()));
    return Buffer.from(digest).toString("hex");
  },
}));
vi.mock("@/server/log", () => ({
  log: {
    info: (...args: unknown[]) => logged.push(args),
    warn: (...args: unknown[]) => logged.push(args),
    error: (...args: unknown[]) => logged.push(args),
  },
}));

const { importAllowlistAction } = await import("./actions");

const CSV = "Nome;E-mail\nMaria Silva;Maria@Exemplo.org\nJoão;joao@exemplo.org\nZé;ze@\n";

function form(file: File | string | null, source: string | null = "academy"): FormData {
  const data = new FormData();
  if (file !== null) data.set("arquivo", file);
  if (source !== null) data.set("origem", source);
  return data;
}
const csvFile = (content = CSV, name = "lista.csv") => new File([content], name, { type: "text/csv" });
const idle = { status: "idle" } as const;

beforeEach(() => {
  calls.length = 0;
  logged.length = 0;
  answer = { data: { received: 2, promoted: 1 }, error: null };
});

describe("importAllowlistAction", () => {
  it("envia só HMACs e devolve as contagens e os números das linhas ruins, nunca e-mails", async () => {
    const state = await importAllowlistAction(idle, form(csvFile()));
    expect(state).toEqual({ status: "done", received: 2, promoted: 1, invalidLines: [4], invalidLineCount: 1 });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.fn).toBe("import_allowlist");
    expect(calls[0]?.args.p_source).toBe("academy");
    const hmacs = calls[0]?.args.p_email_hmacs as string[];
    expect(hmacs).toHaveLength(2);
    for (const hmac of hmacs) expect(hmac).toMatch(/^[0-9a-f]{64}$/);
    // Nada do arquivo no banco, no log nem no estado que volta para o navegador.
    const everything = JSON.stringify([calls, logged, state]);
    expect(everything).not.toMatch(/maria|joao|silva|exemplo|@/i);
  });

  it("aceita .txt com um e-mail por linha e a origem escolhida", async () => {
    await importAllowlistAction(idle, form(csvFile("a@x.org\nb@x.org\n", "LISTA.TXT"), "manual"));
    expect(calls[0]?.args.p_source).toBe("manual");
  });

  it("sem arquivo, arquivo vazio, extensão errada ou origem inválida: recusa sem chamar o banco", async () => {
    expect(await importAllowlistAction(idle, form(null))).toEqual({ status: "error", error: "no_file" });
    expect(await importAllowlistAction(idle, form("a@x.org"))).toEqual({ status: "error", error: "no_file" });
    expect(await importAllowlistAction(idle, form(csvFile("")))).toEqual({ status: "error", error: "no_file" });
    expect(await importAllowlistAction(idle, form(csvFile(CSV, "lista.xlsx")))).toEqual({ status: "error", error: "wrong_type" });
    expect(await importAllowlistAction(idle, form(csvFile(), "planilha"))).toEqual({ status: "error", error: "invalid_source" });
    expect(await importAllowlistAction(idle, form(csvFile(), null))).toEqual({ status: "error", error: "invalid_source" });
    expect(calls).toEqual([]);
  });

  it("arquivo acima do limite é recusado pelo tamanho, sem ser lido", async () => {
    const big = csvFile("a".repeat(allowlistLimits.maxBytes + 1));
    const read = vi.spyOn(big, "text");
    expect(await importAllowlistAction(idle, form(big))).toEqual({ status: "error", error: "too_large" });
    expect(read).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });

  it("arquivo sem nenhum e-mail: empty, sem chamar o banco", async () => {
    expect(await importAllowlistAction(idle, form(csvFile("nome\nMaria\n")))).toEqual({ status: "error", error: "empty" });
    expect(calls).toEqual([]);
  });

  it("recusa do banco (42501, quem não é gestor da raiz): forbidden, sem texto do banco no log", async () => {
    answer = { data: null, error: { code: "42501", message: "só o gestor importa maria@exemplo.org" } };
    expect(await importAllowlistAction(idle, form(csvFile()))).toEqual({ status: "error", error: "forbidden" });
    expect(JSON.stringify(logged)).not.toMatch(/maria|@/i);
  });

  it("outra falha do banco: failed, com só o código no log", async () => {
    answer = { data: null, error: { code: "57014", message: "timeout com maria@exemplo.org" } };
    expect(await importAllowlistAction(idle, form(csvFile()))).toEqual({ status: "error", error: "failed" });
    expect(logged).toEqual([["allowlist_import_failed", { reason: "db_error" }]]);
  });
});
