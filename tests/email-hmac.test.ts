import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { emailBlindIndexWith } from "@/server/crypto/field";
import { importKeyring } from "@/server/crypto/keys";

// `deploy/email-hmac.mjs` roda DENTRO do container do app (bootstrap da primeira coordenação, #295):
// o HMAC do e-mail nasce com a chave do app e tem de ser byte a byte o mesmo de `emailBlindIndex`.
const blind = randomBytes(32);
const field = randomBytes(32);
const env = { PATH: process.env.PATH ?? "", BLIND_INDEX_KEY: blind.toString("base64") };

function run(stdin: string, extra: Record<string, string> = {}, base: Record<string, string> = env) {
  return spawnSync("node", ["deploy/email-hmac.mjs"], { input: stdin, encoding: "utf8", env: { ...base, ...extra } });
}

describe("deploy/email-hmac.mjs", () => {
  it("devolve o mesmo HMAC do app (normaliza espaços e maiúsculas)", async () => {
    const keyring = await importKeyring({ currentVersion: 1, fieldKeys: new Map([[1, new Uint8Array(field)]]), blindIndexKey: new Uint8Array(blind) });
    const esperado = await emailBlindIndexWith(keyring, "ana.teste@exemplo.org");
    for (const entrada of ["ana.teste@exemplo.org\n", "  Ana.Teste@Exemplo.ORG \n", "ana.teste@exemplo.org"]) {
      const r = run(entrada);
      expect(r.status).toBe(0);
      expect(r.stdout).toBe(`${esperado}\n`);
      expect(r.stdout.trim()).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("recusa e-mail inválido sem imprimir nada no stdout nem ecoar o valor", () => {
    for (const ruim of ["", "sem-arroba", "a b@exemplo.org", `${"x".repeat(250)}@exemplo.org`]) {
      const r = run(`${ruim}\n`);
      expect(r.status).not.toBe(0);
      expect(r.stdout).toBe("");
      if (ruim.length > 0) expect(r.stderr).not.toContain(ruim);
    }
  });

  it("falha fechado sem a chave ou com a chave inválida, sem ecoá-la", () => {
    const sem = run("ana@exemplo.org\n", {}, { PATH: env.PATH });
    expect(sem.status).not.toBe(0);
    expect(sem.stdout).toBe("");
    const ruim = run("ana@exemplo.org\n", { BLIND_INDEX_KEY: "curta" });
    expect(ruim.status).not.toBe(0);
    expect(ruim.stdout).toBe("");
    expect(ruim.stderr).not.toContain("curta");
  });
});
