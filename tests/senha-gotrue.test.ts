// Configuração do GoTrue e do Kong para a senha opcional (ADR 0018). O .yml é lido como texto,
// com as chaves ancoradas no começo da linha: um comentário que cite a chave não conta.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const compose = readFileSync("deploy/docker-compose.supabase.yml", "utf8");
const kong = readFileSync("deploy/kong.yml", "utf8");
const localConfig = readFileSync("supabase/config.toml", "utf8");

/** Valor da chave `CHAVE: valor` no começo da linha (sem comentário no fim); null se não existe. */
function composeValue(key: string): string | null {
  const match = new RegExp(`^[ \\t]*${key}:[ \\t]*"?([^"#\\n]*?)"?[ \\t]*(?:#.*)?$`, "m").exec(compose);
  return match?.[1] ?? null;
}

describe("GoTrue do servidor (ADR 0018 §2 e §5)", () => {
  it.each([
    ["GOTRUE_PASSWORD_MIN_LENGTH", "12"],
    ["GOTRUE_PASSWORD_HIBP_ENABLED", "true"],
    ["GOTRUE_SECURITY_UPDATE_PASSWORD_REQUIRE_REAUTHENTICATION", "true"],
    ["GOTRUE_SECURITY_UPDATE_PASSWORD_REQUIRE_CURRENT_PASSWORD", "true"],
  ])("%s = %s", (key, expected) => {
    expect(composeValue(key)).toBe(expected);
  });

  it("não exige símbolos nem maiúsculas (a chave de caracteres obrigatórios não existe)", () => {
    expect(composeValue("GOTRUE_PASSWORD_REQUIRED_CHARACTERS")).toBeNull();
  });

  it("senha vazada não falha fechado: com a API fora, vale a lista local do app", () => {
    expect(composeValue("GOTRUE_PASSWORD_HIBP_FAIL_CLOSED")).not.toBe("true");
  });
});

/** O bloco de um serviço do kong.yml que declara o caminho dado (do `- name:` ao próximo serviço). */
function kongServiceWithPath(path: string): string | null {
  const blocks = kong.split(/^ {2}- name: /m).slice(1);
  return blocks.find((block) => new RegExp(`^\\s*-\\s+${path.replaceAll("/", "\\/")}\\s*$`, "m").test(block)) ?? null;
}
const terminates404 = (block: string) => /name:\s*request-termination[\s\S]*?status_code:\s*404/.test(block);

describe("Kong (ADR 0018 §1, §3)", () => {
  it("o cadastro com senha tem a PRÓPRIA rota amarrada ao request-termination 404 (defesa em profundidade)", () => {
    const block = kongServiceWithPath("/auth/v1/signup");
    expect(block, "serviço com /auth/v1/signup").not.toBeNull();
    expect(terminates404(block!)).toBe(true);
    // Sem condição: bloqueia também a chamada interna, que o app nunca faz.
    expect(block).not.toMatch(/headers:/);
  });

  it.each(["token", "recover", "otp", "magiclink", "resend", "user", "reauthenticate"])(
    "/auth/v1/%s vindo de fora (com X-Forwarded-For do proxy) responde 404; a chamada interna do app passa",
    (name) => {
      const block = kongServiceWithPath(`/auth/v1/${name}`);
      expect(block, `serviço com /auth/v1/${name}`).not.toBeNull();
      expect(terminates404(block!)).toBe(true);
      expect(block).toMatch(/headers:\s*\n\s*x-forwarded-for:\s*\["~\*\.\+"\]/);
    },
  );

  it("o que o navegador usa (verify, authorize, callback) NÃO é bloqueado", () => {
    for (const name of ["verify", "authorize", "callback"]) expect(kongServiceWithPath(`/auth/v1/${name}`)).toBeNull();
  });
});

describe("Supabase local (e2e)", () => {
  it("usa o mesmo mínimo de 12 caracteres do servidor", () => {
    expect(localConfig).toMatch(/^minimum_password_length\s*=\s*12\s*$/m);
  });

  it("e-mail de recuperação usa o modelo do app, que leva a /auth/confirmar", () => {
    expect(localConfig).toMatch(/\[auth\.email\.template\.recovery\]/);
    const template = readFileSync("supabase/templates/recovery.html", "utf8");
    expect(template).toContain("/auth/confirmar?token_hash={{ .TokenHash }}&amp;type=recovery");
  });
});
