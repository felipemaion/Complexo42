import { describe, expect, it } from "vitest";
import { decodeKey, parseEnv } from "./env";

describe("parseEnv", () => {
  it("aceita produção com a URL de saúde do banco e aplica padrões", () => {
    const result = parseEnv({ NODE_ENV: "production", DB_HEALTH_URL: "http://rest:3001/ready" });
    expect(result).toEqual({
      ok: true,
      env: expect.objectContaining({ DB_HEALTH_URL: "http://rest:3001/ready", HEALTH_TIMEOUT_MS: 2000, LOG_DIR: "data/logs" }),
    });
  });

  it("em desenvolvimento o banco é opcional", () => {
    expect(parseEnv({ NODE_ENV: "development" }).ok).toBe(true);
  });

  it("em produção, falta de DB_HEALTH_URL é erro com o nome da variável", () => {
    expect(parseEnv({ NODE_ENV: "production" })).toEqual({ ok: false, problems: ["DB_HEALTH_URL: obrigatória em produção"] });
  });

  it("lista a variável faltando junto com as inválidas", () => {
    const result = parseEnv({ NODE_ENV: "production", HEALTH_TIMEOUT_MS: "abc" });
    expect(result).toEqual({
      ok: false,
      problems: ["HEALTH_TIMEOUT_MS: precisa ser um número", "DB_HEALTH_URL: obrigatória em produção"],
    });
  });

  it("variável vazia conta como ausente", () => {
    expect(parseEnv({ NODE_ENV: "production", DB_HEALTH_URL: "", GIT_SHA: "" }).ok).toBe(false);
  });

  it("nunca imprime o valor recebido", () => {
    const secret = "postgres://u:senha-secreta@db:5432/x";
    const result = parseEnv({ NODE_ENV: "production", DB_HEALTH_URL: secret, HEALTH_TIMEOUT_MS: "senha-secreta", GIT_SHA: "senha-secreta" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems.map((p) => p.split(":")[0])).toEqual(["DB_HEALTH_URL", "HEALTH_TIMEOUT_MS", "GIT_SHA"]);
    expect(result.problems.join("\n")).not.toContain("senha-secreta");
  });
});

describe("chaves de criptografia (#45)", () => {
  const b64 = () => Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64");
  const prod = { NODE_ENV: "production", DB_HEALTH_URL: "http://rest:3001/ready" };
  const fail = (raw: Record<string, string>) => {
    const result = parseEnv(raw);
    return result.ok ? [] : result.problems;
  };

  it("são opcionais na subida: produção sem chaves sobe (rota sem criptografia não depende delas)", () => {
    expect(parseEnv(prod).ok).toBe(true);
  });

  it("aceita chaves de 32 bytes e versão com padrão 1", () => {
    const result = parseEnv({ ...prod, FIELD_ENCRYPTION_KEY: b64(), BLIND_INDEX_KEY: b64() });
    expect(result.ok && result.env.FIELD_ENCRYPTION_KEY_VERSION).toBe(1);
  });

  it("recusa chave fora do formato sem imprimir o valor", () => {
    const short = Buffer.alloc(16, 7).toString("base64");
    const problems = fail({ NODE_ENV: "development", FIELD_ENCRYPTION_KEY: short, BLIND_INDEX_KEY: "nao-e-base64-mesmo-com-44-caracteres-aqui!!=" });
    expect(problems.map((p) => p.split(":")[0])).toEqual(["FIELD_ENCRYPTION_KEY", "BLIND_INDEX_KEY"]);
    expect(problems.join("\n")).not.toContain(short);
  });

  it("decodifica base64 só no formato canônico", () => {
    const key = b64();
    expect(decodeKey(key)).toHaveLength(32);
    expect(decodeKey(key.replace(/=$/, ""))).toBeNull();
    expect(decodeKey(key.replace(/.=$/, "B="))).toBeNull(); // bits sobrando no último caractere
    expect(decodeKey(`${key} `)).toBeNull();
  });

  it("exige chaves diferentes para AES e HMAC", () => {
    const same = b64();
    expect(fail({ NODE_ENV: "development", FIELD_ENCRYPTION_KEY: same, BLIND_INDEX_KEY: same })).toEqual([
      "BLIND_INDEX_KEY: precisa ser diferente de FIELD_ENCRYPTION_KEY",
    ]);
  });

  it("valida chaves antigas da rotação: formato, versão menor que a atual e sem repetir", () => {
    const base = { NODE_ENV: "development", FIELD_ENCRYPTION_KEY: b64(), BLIND_INDEX_KEY: b64(), FIELD_ENCRYPTION_KEY_VERSION: "3" };
    expect(parseEnv({ ...base, FIELD_ENCRYPTION_PREVIOUS_KEYS: `v1:${b64()}, v2:${b64()}` }).ok).toBe(true);
    expect(fail({ ...base, FIELD_ENCRYPTION_PREVIOUS_KEYS: `v3:${b64()}` })[0]).toMatch(/^FIELD_ENCRYPTION_PREVIOUS_KEYS: versões antigas/);
    expect(fail({ ...base, FIELD_ENCRYPTION_PREVIOUS_KEYS: `v1:${b64()},v1:${b64()}` })[0]).toMatch(/^FIELD_ENCRYPTION_PREVIOUS_KEYS: formato/);
    expect(fail({ ...base, FIELD_ENCRYPTION_PREVIOUS_KEYS: b64() })[0]).toMatch(/^FIELD_ENCRYPTION_PREVIOUS_KEYS: formato/);
    expect(fail({ NODE_ENV: "development", FIELD_ENCRYPTION_KEY_VERSION: "2", FIELD_ENCRYPTION_PREVIOUS_KEYS: `v1:${b64()}` })).toEqual([
      "FIELD_ENCRYPTION_PREVIOUS_KEYS: exige FIELD_ENCRYPTION_KEY",
    ]);
  });
});
