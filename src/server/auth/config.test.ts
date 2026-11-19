import { describe, expect, it } from "vitest";
import type { ServerEnv } from "@/server/env";
import { authConfigFrom } from "./config";

const base = { NODE_ENV: "production", HEALTH_TIMEOUT_MS: 2000, LOG_DIR: "x", FIELD_ENCRYPTION_KEY_VERSION: 1 } as ServerEnv;

describe("authConfigFrom (#9)", () => {
  it("sem URL ou chave, o login fica desligado", () => {
    expect(authConfigFrom(base)).toBeNull();
    expect(authConfigFrom({ ...base, SUPABASE_URL: "http://kong:8000" })).toBeNull();
  });

  it("separa a URL interna da pública e tira a barra final", () => {
    const config = authConfigFrom({
      ...base,
      SUPABASE_URL: "http://kong:8000/",
      SUPABASE_PUBLIC_URL: "https://app.exemplo.org/",
      SUPABASE_ANON_KEY: "sb_publishable_x",
      SITE_URL: "https://app.exemplo.org/",
    });
    expect(config).toEqual({
      internalUrl: "http://kong:8000",
      publicUrl: "https://app.exemplo.org",
      anonKey: "sb_publishable_x",
      siteUrl: "https://app.exemplo.org",
    });
  });

  it("no local, a URL pública é a mesma do Supabase e o site é o next dev", () => {
    const config = authConfigFrom({ ...base, SUPABASE_URL: "http://127.0.0.1:54321", SUPABASE_ANON_KEY: "sb_publishable_x" });
    expect(config?.publicUrl).toBe("http://127.0.0.1:54321");
    expect(config?.siteUrl).toBe("http://127.0.0.1:3000");
  });
});
