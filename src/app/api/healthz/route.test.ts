import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

vi.mock("@/server/log", () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function setup(fetchImpl: (url: string) => Promise<Response>) {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("DB_HEALTH_URL", "http://rest:3001/ready");
  vi.stubEnv("GIT_SHA", "abc1234def5678");
  vi.stubEnv("APP_VERSION", "v2026.11.19");
  // Login (#9): obrigatório em produção.
  vi.stubEnv("SUPABASE_URL", "http://kong:8000");
  vi.stubEnv("SUPABASE_ANON_KEY", "sb_publishable_teste");
  vi.stubEnv("SITE_URL", "https://app.exemplo.org");
  // Cifra de campo: obrigatórias em produção desde 2026-11-28. Valores de
  // teste, 32 bytes em base64 -- o healthz não cifra nada, mas o app recusa
  // subir sem elas, e é esse o ponto.
  vi.stubEnv("FIELD_ENCRYPTION_KEY", "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=");
  vi.stubEnv("BLIND_INDEX_KEY", "AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI=");
  // Em produção o caminho do questionário real é obrigatório (#313).
  vi.stubEnv("QUESTIONNAIRE_PATH", "/app/questionario/questionnaire.json");
  vi.stubEnv("TURNSTILE_SITE_KEY", `0x${"a".repeat(22)}`);
  vi.stubEnv("TURNSTILE_SECRET_KEY", `0x${"b".repeat(33)}`);
  vi.stubGlobal("fetch", vi.fn(fetchImpl));
}

/**
 * Corpo real do PostgREST com o cache de esquema velho, copiado da resposta
 * que o staging devolveu em 2026-11-28 -- a mesma que quebrou o login.
 */
const PGRST205 = JSON.stringify({
  code: "PGRST205",
  message: "Could not find the table 'public.profiles' in the schema cache",
});

describe("GET /api/healthz", () => {
  it("200, sem cache, com versão, quando banco e esquema respondem", async () => {
    setup(async () => new Response("ok"));
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({
      status: "ok",
      version: { tag: "v2026.11.19", commit: "abc1234def56" },
      db: "ok",
      schema: "ok",
    });
  });

  it("503 sem detalhe do erro quando o banco cai", async () => {
    setup(async () => {
      throw new TypeError("connect ECONNREFUSED 10.1.2.3:3001");
    });
    const res = await GET();
    expect(res.status).toBe(503);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const text = await res.text();
    expect(JSON.parse(text)).toMatchObject({ status: "degraded", db: "unavailable" });
    expect(text).not.toMatch(/ECONNREFUSED|10\.1\.2\.3|rest:3001|stack/);
  });

  // O caso das 19 horas no staging: o /ready do PostgREST responde 200 e toda
  // leitura da ao 404, porque o cache de esquema nao conhece as tabelas.
  it("503 quando o banco responde mas o esquema esta velho", async () => {
    setup(async (url) =>
      url.includes("/rest/v1/") ? new Response(PGRST205, { status: 404 }) : new Response("ok"),
    );
    const res = await GET();
    expect(res.status).toBe(503);
    const corpo = await res.text();
    expect(JSON.parse(corpo)).toMatchObject({ status: "degraded", db: "ok", schema: "stale" });
    // Nem a chave anon nem a mensagem do PostgREST vazam na resposta.
    expect(corpo).not.toMatch(/PGRST205|schema cache|sb_publishable|kong:8000/);
  });

  it("nao esconde esquema velho atras de banco indisponivel: sao estados separados", async () => {
    setup(async (url) => {
      if (url.includes("/rest/v1/")) return new Response(PGRST205, { status: 404 });
      throw new TypeError("connect ECONNREFUSED 10.1.2.3:3001");
    });
    expect(JSON.parse(await (await GET()).text())).toMatchObject({ db: "unavailable", schema: "stale" });
  });
});
