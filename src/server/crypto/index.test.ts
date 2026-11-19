// API pública do módulo lida do ambiente (#45): chaves via variáveis, erro claro sem elas,
// marcação server-only e chaves de teste do setup local.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseEnv as parseDotenv } from "node:util";
import { fillTestKeys } from "../../../scripts/gen-test-keys.mjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseEnv } from "../env";
import { decryptField, emailBlindIndex, encryptField, keyVersionOf, reencryptField, whatsappBlindIndex } from "./index";
import { resetKeyringCache } from "./keys";

const b64 = () => Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64");
const ctx = { table: "profiles", column: "display_name_enc", rowId: "42" };

function stubKeys(vars: Record<string, string | undefined>): void {
  for (const [name, value] of Object.entries(vars)) vi.stubEnv(name, value);
  resetKeyringCache();
}

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "test");
  stubKeys({ FIELD_ENCRYPTION_KEY: undefined, BLIND_INDEX_KEY: undefined, FIELD_ENCRYPTION_KEY_VERSION: undefined, FIELD_ENCRYPTION_PREVIOUS_KEYS: undefined });
});
afterEach(() => {
  vi.unstubAllEnvs();
  resetKeyringCache();
});

describe("chaves vindas do ambiente", () => {
  it("cifra, decifra e indexa com FIELD_ENCRYPTION_KEY e BLIND_INDEX_KEY", async () => {
    stubKeys({ FIELD_ENCRYPTION_KEY: b64(), BLIND_INDEX_KEY: b64() });
    const value = await encryptField("Maria", ctx);
    expect(keyVersionOf(value)).toBe(1);
    expect(await decryptField(value, ctx)).toBe("Maria");
    expect(await emailBlindIndex(" Maria@Exemplo.org")).toBe(await emailBlindIndex("maria@exemplo.org"));
    expect(await whatsappBlindIndex("+5511999998888")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("sem as chaves, falha com missing_key e mensagem sem valores", async () => {
    await expect(encryptField("Maria", ctx)).rejects.toMatchObject({ code: "missing_key" });
    stubKeys({ FIELD_ENCRYPTION_KEY: b64() });
    await expect(emailBlindIndex("maria@exemplo.org")).rejects.toMatchObject({ code: "missing_key" });
    await expect(decryptField("v1.AAAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAAAAAAAA", ctx)).rejects.toThrow(/^Chaves de criptografia ausentes/);
  });

  it("rotação pelo ambiente: chave v2 atual e v1 em FIELD_ENCRYPTION_PREVIOUS_KEYS", async () => {
    const [v1, v2, blind] = [b64(), b64(), b64()];
    stubKeys({ FIELD_ENCRYPTION_KEY: v1, BLIND_INDEX_KEY: blind });
    const legacy = await encryptField("Maria", ctx);

    stubKeys({ FIELD_ENCRYPTION_KEY: v2, FIELD_ENCRYPTION_KEY_VERSION: "2", FIELD_ENCRYPTION_PREVIOUS_KEYS: `v1:${v1}` });
    expect(await decryptField(legacy, ctx)).toBe("Maria");
    const rotated = await reencryptField(legacy, ctx);
    expect(keyVersionOf(rotated)).toBe(2);

    // Sem a chave antiga configurada, o valor legado vira versão desconhecida.
    stubKeys({ FIELD_ENCRYPTION_PREVIOUS_KEYS: undefined });
    await expect(decryptField(legacy, ctx)).rejects.toMatchObject({ code: "unknown_version" });
    expect(await decryptField(rotated, ctx)).toBe("Maria");
  });
});

describe("chaves de teste do setup local (#52)", () => {
  it("o .env.example com as chaves geradas por gen-test-keys passa na validação e cifra", async () => {
    const example = readFileSync(".env.example", "utf8");
    // Vazias no .env.example: contam como ausentes e não derrubam a subida.
    expect(parseEnv({ ...parseDotenv(example), NODE_ENV: "development" }).ok).toBe(true);

    const vars = parseDotenv(fillTestKeys(example).content);
    expect(parseEnv({ ...vars, NODE_ENV: "development" }).ok).toBe(true);
    stubKeys({ FIELD_ENCRYPTION_KEY: vars.FIELD_ENCRYPTION_KEY, BLIND_INDEX_KEY: vars.BLIND_INDEX_KEY });
    expect(await decryptField(await encryptField("Maria", ctx), ctx)).toBe("Maria");
  });
});

describe("server-only", () => {
  it("todo arquivo de código do módulo começa marcado com server-only", () => {
    const dir = "src/server/crypto";
    const sources = readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
    expect(sources.length).toBeGreaterThan(0);
    for (const file of sources) {
      const code = readFileSync(join(dir, file), "utf8");
      const firstImport = code.split("\n").find((line) => line.startsWith("import "));
      expect(firstImport, file).toBe('import "server-only";');
    }
  });
});
