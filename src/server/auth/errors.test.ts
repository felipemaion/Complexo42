import { describe, expect, it } from "vitest";
import { classifyAuthError, isExpiredSession, parseAuthErrorCode } from "./errors";

describe("erros do login (#9)", () => {
  it("só aceita códigos conhecidos vindos da URL", () => {
    expect(parseAuthErrorCode("rate_limited")).toBe("rate_limited");
    expect(parseAuthErrorCode("legacy_link")).toBe("legacy_link");
    expect(parseAuthErrorCode("<script>")).toBeNull();
    expect(parseAuthErrorCode(["failed"])).toBeNull();
    expect(parseAuthErrorCode(undefined)).toBeNull();
  });

  it("classifica pelo status e código, nunca pela mensagem", () => {
    expect(classifyAuthError({ status: 429 })).toBe("rate_limited");
    expect(classifyAuthError({ status: 400, code: "over_email_send_rate_limit" })).toBe("rate_limited");
    expect(classifyAuthError({ name: "AuthRetryableFetchError", status: 0 })).toBe("unavailable");
    expect(classifyAuthError({ status: 502 })).toBe("unavailable");
    expect(classifyAuthError({ status: 400, code: "otp_expired" })).toBe("failed");
    expect(classifyAuthError(null)).toBe("failed");
  });
});

describe("isExpiredSession (timebox da sessão)", () => {
  it("reconhece os códigos de sessão vencida do GoTrue, sem olhar a mensagem", () => {
    for (const code of ["session_expired", "refresh_token_not_found", "session_not_found"]) {
      expect(isExpiredSession({ code, status: 400 }), code).toBe(true);
    }
  });

  it("não confunde com erro de rede, limite ou falha do servidor", () => {
    for (const error of [null, undefined, {}, { code: "over_request_rate_limit", status: 429 }, { code: "unexpected_failure", status: 500 }, { name: "AuthRetryableFetchError" }]) {
      expect(isExpiredSession(error), JSON.stringify(error)).toBe(false);
    }
  });
});
