// Contrato do ambiente de desenvolvimento (#52): scripts npm, .env.example só com valores de
// teste, geração das chaves de teste e devcontainer coerente com o projeto.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { KEY_NAMES, fillTestKeys, generateKey } from "../scripts/gen-test-keys.mjs";
import { ensureEnvFile } from "../scripts/setup.mjs";

const readJson = <T>(file: string): T => JSON.parse(readFileSync(file, "utf8")) as T;
const envExample = readFileSync(".env.example", "utf8");

/** Pares NOME=valor das linhas não comentadas. */
function parseDotenv(text: string): Map<string, string> {
  const vars = new Map<string, string>();
  for (const line of text.split("\n")) {
    const m = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line.trim());
    if (m?.[1]) vars.set(m[1], m[2] ?? "");
  }
  return vars;
}

describe("scripts npm", () => {
  const { scripts } = readJson<{ scripts: Record<string, string> }>("package.json");

  it.each(["setup", "gen-test-keys", "db:start", "db:stop", "db:reset", "db:test", "test:e2e", "check"])(
    "define %s",
    (name) => {
      expect(scripts[name]).toBeTruthy();
    },
  );

  it("usa a CLI do Supabase local (devDependency), não uma global", () => {
    const pkg = readJson<{ devDependencies: Record<string, string> }>("package.json");
    expect(pkg.devDependencies.supabase).toBeTruthy();
    expect(readFileSync("scripts/setup.mjs", "utf8")).toMatch(/run\("npx", \["supabase", "start"\]\)/);
  });
});

describe(".env.example", () => {
  const vars = parseDotenv(envExample);

  it("declara as chaves de criptografia vazias (preenchidas pelo setup)", () => {
    for (const name of KEY_NAMES) expect(vars.get(name)).toBe("");
  });

  it("não traz nenhum valor com cara de segredo", () => {
    for (const [name, value] of vars) {
      if (/^https?:\/\//.test(value)) {
        expect(new URL(value).hostname, name).toBe("127.0.0.1");
      } else {
        expect(value, name).not.toMatch(/[A-Za-z0-9+/=_-]{24,}/);
      }
    }
  });

  it("está fora do .gitignore e o .env.local está dentro", () => {
    const ignore = readFileSync(".gitignore", "utf8");
    expect(ignore).toMatch(/^!\.env\.example$/m);
    expect(ignore).toMatch(/^\.env\.\*$/m);
  });
});

describe("fillTestKeys", () => {
  const fake = () => "CHAVE_FALSA";

  it("preenche as chaves vazias do .env.example", () => {
    const { content, filled } = fillTestKeys(envExample, fake);
    expect(filled).toEqual([...KEY_NAMES]);
    for (const name of KEY_NAMES) expect(parseDotenv(content).get(name)).toBe("CHAVE_FALSA");
  });

  it("acrescenta chaves ausentes sem perder o resto do arquivo", () => {
    const { content, filled } = fillTestKeys("OUTRA=1", fake);
    expect(filled).toEqual([...KEY_NAMES]);
    expect(parseDotenv(content).get("OUTRA")).toBe("1");
    expect(content.endsWith("\n")).toBe(true);
  });

  it("nunca troca uma chave que já existe (idempotente)", () => {
    const first = fillTestKeys(envExample).content;
    const second = fillTestKeys(first, () => {
      throw new Error("não deveria gerar chave nova");
    });
    expect(second).toEqual({ content: first, filled: [] });
  });

  it("gera base64 de 32 bytes, diferente a cada chamada", () => {
    const a = generateKey();
    expect(Buffer.from(a, "base64")).toHaveLength(32);
    expect(generateKey()).not.toBe(a);
  });
});

describe("arquivos locais", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "c42-setup-"));
    writeFileSync(join(dir, ".env.example"), envExample);
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("ensureEnvFile cria o .env.local uma vez e depois não sobrescreve", () => {
    expect(ensureEnvFile(dir).created).toBe(true);
    writeFileSync(join(dir, ".env.local"), "EDITADO=1\n");
    expect(ensureEnvFile(dir).created).toBe(false);
    expect(readFileSync(join(dir, ".env.local"), "utf8")).toBe("EDITADO=1\n");
  });

  it("gen-test-keys pela linha de comando: preenche, não vaza valores e é idempotente", () => {
    const file = join(dir, ".env.local");
    writeFileSync(file, envExample);
    const run = () => spawnSync(process.execPath, ["scripts/gen-test-keys.mjs", file], { encoding: "utf8" });

    const first = run();
    expect(first.status).toBe(0);
    const filled = readFileSync(file, "utf8");
    for (const name of KEY_NAMES) {
      const value = parseDotenv(filled).get(name) ?? "";
      expect(Buffer.from(value, "base64")).toHaveLength(32);
      expect(first.stdout).not.toContain(value);
    }
    if (process.platform !== "win32") expect(statSync(file).mode & 0o077).toBe(0);

    expect(run().status).toBe(0);
    expect(readFileSync(file, "utf8")).toBe(filled);
  });

  it("gen-test-keys falha com mensagem clara se o arquivo não existe", () => {
    const r = spawnSync(process.execPath, ["scripts/gen-test-keys.mjs", join(dir, "nao-existe")], { encoding: "utf8" });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("npm run setup");
  });
});

describe("devcontainer", () => {
  type Devcontainer = {
    image: string;
    features: Record<string, unknown>;
    forwardPorts: number[];
    postCreateCommand: string;
  };
  const dc = readJson<Devcontainer>(".devcontainer/devcontainer.json");

  it("usa a mesma versão maior do Node que o .nvmrc", () => {
    const major = readFileSync(".nvmrc", "utf8").trim().split(".")[0];
    expect(dc.image).toMatch(new RegExp(`typescript-node:\\d+-${major}-`));
  });

  it("tem Docker (para o Supabase local) e encaminha as portas do app e da API", () => {
    expect(Object.keys(dc.features).some((f) => f.includes("docker-in-docker"))).toBe(true);
    expect(dc.forwardPorts).toEqual(expect.arrayContaining([3000, 54321]));
  });

  it("instala as dependências ao criar o contêiner", () => {
    expect(dc.postCreateCommand).toBe("npm ci");
  });
});
