import { describe, expect, it } from "vitest";
import { classifyAuthError, parseAuthErrorCode } from "./errors";

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
