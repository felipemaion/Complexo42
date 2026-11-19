import { describe, expect, it } from "vitest";
import { parseEnv } from "./env";

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
