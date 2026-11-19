// Regras puras da exclusão de conta (#18): leitura da hora do login no JWT, janela de
// reautenticação e palavra de confirmação.
import { describe, expect, it } from "vitest";
import {
  authAgeSeconds,
  deleteAccountFormSchema,
  isRecentLogin,
  parseDeleteAccountStatus,
  REAUTH_WINDOW_SECONDS,
} from "./delete-account";

const NOW = 1_795_077_429;
const jwt = (claims: unknown) =>
  `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.assinatura`;

describe("authAgeSeconds", () => {
  it("usa o login mais recente do amr", () => {
    const token = jwt({ amr: [{ method: "otp", timestamp: NOW - 900 }, { method: "oauth", timestamp: NOW - 60 }] });
    expect(authAgeSeconds(token, NOW)).toBe(60);
  });

  it("sem token, sem amr, amr vazio ou malformado: null (a tela pede para entrar de novo)", () => {
    expect(authAgeSeconds(null, NOW)).toBeNull();
    expect(authAgeSeconds(undefined, NOW)).toBeNull();
    expect(authAgeSeconds("sem-pontos", NOW)).toBeNull();
    expect(authAgeSeconds("a.%%%.c", NOW)).toBeNull();
    expect(authAgeSeconds(jwt({ sub: "x" }), NOW)).toBeNull();
    expect(authAgeSeconds(jwt({ amr: [] }), NOW)).toBeNull();
    expect(authAgeSeconds(jwt({ amr: [{ method: "otp", timestamp: "ontem" }] }), NOW)).toBeNull();
  });
});

describe("isRecentLogin", () => {
  it("vale até 10 minutos, igual ao banco", () => {
    expect(REAUTH_WINDOW_SECONDS).toBe(600);
    expect(isRecentLogin(0)).toBe(true);
    expect(isRecentLogin(600)).toBe(true);
    expect(isRecentLogin(601)).toBe(false);
    expect(isRecentLogin(null)).toBe(false);
  });
});

describe("deleteAccountFormSchema", () => {
  it("aceita a palavra, sem diferenciar maiúsculas nem espaços nas pontas", () => {
    expect(deleteAccountFormSchema.safeParse({ confirmation: "EXCLUIR" }).success).toBe(true);
    expect(deleteAccountFormSchema.safeParse({ confirmation: "  excluir " }).success).toBe(true);
  });

  it("recusa vazio, outra palavra, quase igual ou tipo errado", () => {
    for (const confirmation of ["", "sim", "EXCLUI", "EXCLUIR CONTA", null, undefined, 1, "x".repeat(65)]) {
      expect(deleteAccountFormSchema.safeParse({ confirmation }).success).toBe(false);
    }
  });
});

describe("parseDeleteAccountStatus", () => {
  it("só aceita os motivos conhecidos", () => {
    expect(parseDeleteAccountStatus("reautenticar")).toBe("reautenticar");
    expect(parseDeleteAccountStatus(["confirmacao"])).toBe("confirmacao");
    expect(parseDeleteAccountStatus("<script>")).toBeNull();
    expect(parseDeleteAccountStatus(undefined)).toBeNull();
  });
});
