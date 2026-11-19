import { describe, expect, it } from "vitest";
import { decodeKey, parseEnv } from "./env";

const jwt = (payload: object) => `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.assinatura`;
// Login (#9) e Turnstile (#116): obrigatórias em produção junto com DB_HEALTH_URL. Chaves
// fictícias de baixa entropia, só no formato.
const TURNSTILE = { TURNSTILE_SITE_KEY: `0x${"a".repeat(22)}`, TURNSTILE_SECRET_KEY: `0x${"b".repeat(33)}` };
const AUTH = { SUPABASE_URL: "http://kong:8000", SUPABASE_ANON_KEY: jwt({ role: "anon" }), SITE_URL: "https://app.exemplo.org", ...TURNSTILE };
const AUTH_MISSING = [
  "SUPABASE_URL: obrigatória em produção",
  "SUPABASE_ANON_KEY: obrigatória em produção",
  "SITE_URL: obrigatória em produção",
  "TURNSTILE_SITE_KEY: obrigatória em produção",
  "TURNSTILE_SECRET_KEY: obrigatória em produção",
];

describe("parseEnv", () => {
  it("aceita produção com a URL de saúde do banco e aplica padrões", () => {
    const result = parseEnv({ NODE_ENV: "production", DB_HEALTH_URL: "http://rest:3001/ready", ...AUTH });
    expect(result).toEqual({
      ok: true,
      env: expect.objectContaining({ DB_HEALTH_URL: "http://rest:3001/ready", HEALTH_TIMEOUT_MS: 2000, LOG_DIR: "data/logs" }),
    });
  });

  it("em desenvolvimento o banco é opcional", () => {
    expect(parseEnv({ NODE_ENV: "development" }).ok).toBe(true);
  });

  it("em produção, falta de DB_HEALTH_URL é erro com o nome da variável", () => {
    expect(parseEnv({ NODE_ENV: "production" })).toEqual({ ok: false, problems: ["DB_HEALTH_URL: obrigatória em produção", ...AUTH_MISSING] });
  });

  it("lista a variável faltando junto com as inválidas", () => {
    const result = parseEnv({ NODE_ENV: "production", HEALTH_TIMEOUT_MS: "abc" });
    expect(result).toEqual({
      ok: false,
      problems: ["HEALTH_TIMEOUT_MS: precisa ser um número", "DB_HEALTH_URL: obrigatória em produção", ...AUTH_MISSING],
    });
  });

  it("variável vazia conta como ausente", () => {
    expect(parseEnv({ NODE_ENV: "production", DB_HEALTH_URL: "", GIT_SHA: "" }).ok).toBe(false);
  });

  it("nunca imprime o valor recebido", () => {
    const secret = "postgres://u:senha-secreta@db:5432/x";
    const result = parseEnv({ NODE_ENV: "production", ...AUTH, DB_HEALTH_URL: secret, HEALTH_TIMEOUT_MS: "senha-secreta", GIT_SHA: "senha-secreta" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems.map((p) => p.split(":")[0])).toEqual(["DB_HEALTH_URL", "HEALTH_TIMEOUT_MS", "GIT_SHA"]);
    expect(result.problems.join("\n")).not.toContain("senha-secreta");
  });
});

describe("chaves de criptografia (#45)", () => {
  const b64 = () => Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64");
  const prod = { NODE_ENV: "production", DB_HEALTH_URL: "http://rest:3001/ready", ...AUTH };
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

  it("recusa na subida chave antiga igual a BLIND_INDEX_KEY, sem imprimir o valor", () => {
    const blind = b64();
    const problems = fail({ NODE_ENV: "development", FIELD_ENCRYPTION_KEY: b64(), BLIND_INDEX_KEY: blind, FIELD_ENCRYPTION_KEY_VERSION: "3", FIELD_ENCRYPTION_PREVIOUS_KEYS: `v1:${b64()},v2:${blind}` });
    expect(problems).toEqual(["FIELD_ENCRYPTION_PREVIOUS_KEYS: nenhuma chave antiga pode ser igual a BLIND_INDEX_KEY"]);
    expect(problems.join("\n")).not.toContain(blind);
  });
});

describe("login (#9)", () => {
  const prod = { NODE_ENV: "production", DB_HEALTH_URL: "http://rest:3001/ready", ...AUTH };
  const problems = (raw: Record<string, string>) => {
    const result = parseEnv(raw);
    return result.ok ? [] : result.problems;
  };

  it("em produção aceita a URL interna, a pública e a chave anon", () => {
    const result = parseEnv({ ...prod, SUPABASE_PUBLIC_URL: "https://app.exemplo.org" });
    expect(result.ok && result.env.SUPABASE_PUBLIC_URL).toBe("https://app.exemplo.org");
  });

  it("aceita a chave publishable das versões novas", () => {
    expect(parseEnv({ ...prod, SUPABASE_ANON_KEY: "sb_publishable_teste" }).ok).toBe(true);
  });

  it("recusa a chave service_role sem imprimir o valor (R6)", () => {
    const key = jwt({ role: "service_role" });
    const result = problems({ ...prod, SUPABASE_ANON_KEY: key });
    expect(result).toEqual(["SUPABASE_ANON_KEY: precisa ser a chave anon (nunca service_role)"]);
    expect(result.join()).not.toContain(key);
  });

  it("recusa chave secreta e JWT ilegível", () => {
    expect(problems({ ...prod, SUPABASE_ANON_KEY: "sb_secret_abc" })[0]).toMatch(/^SUPABASE_ANON_KEY:/);
    expect(problems({ ...prod, SUPABASE_ANON_KEY: "a.b.c" })).toEqual(["SUPABASE_ANON_KEY: precisa ser a chave anon (nunca service_role)"]);
  });

  it("recusa URL que não é http(s)", () => {
    expect(problems({ ...prod, SITE_URL: "javascript:alert(1)" })[0]).toMatch(/^SITE_URL:/);
  });

  it("TRUST_CF_CONNECTING_IP vem desligado e só aceita true/false", () => {
    const off = parseEnv(prod);
    expect(off.ok && off.env.TRUST_CF_CONNECTING_IP).toBe(false);
    const on = parseEnv({ ...prod, TRUST_CF_CONNECTING_IP: "true" });
    expect(on.ok && on.env.TRUST_CF_CONNECTING_IP).toBe(true);
    expect(problems({ ...prod, TRUST_CF_CONNECTING_IP: "1" })[0]).toMatch(/^TRUST_CF_CONNECTING_IP:/);
  });

  it("em desenvolvimento o login é opcional", () => {
    expect(parseEnv({ NODE_ENV: "development" }).ok).toBe(true);
  });
});

describe("Turnstile (#116)", () => {
  const prod = { NODE_ENV: "production", DB_HEALTH_URL: "http://rest:3001/ready", ...AUTH };

  it("em produção as duas chaves são obrigatórias", () => {
    const rest: Record<string, string> = { ...prod };
    delete rest.TURNSTILE_SITE_KEY;
    delete rest.TURNSTILE_SECRET_KEY;
    expect(parseEnv(rest)).toEqual({
      ok: false,
      problems: ["TURNSTILE_SITE_KEY: obrigatória em produção", "TURNSTILE_SECRET_KEY: obrigatória em produção"],
    });
  });

  it("recusa chave fora do formato sem imprimir o valor", () => {
    const bad = "chave com espaço";
    const result = parseEnv({ ...prod, TURNSTILE_SECRET_KEY: bad });
    expect(result).toEqual({ ok: false, problems: ["TURNSTILE_SECRET_KEY: formato de chave do Turnstile inválido"] });
    expect(JSON.stringify(result)).not.toContain(bad);
  });

  it("fora de produção são opcionais", () => {
    expect(parseEnv({ NODE_ENV: "test" }).ok).toBe(true);
  });
});
