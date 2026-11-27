import { describe, expect, it } from "vitest";
import { refusalMessage, type RefusalTexts } from "./refusal";

const texts: RefusalTexts = {
  errors: {
    unavailable: "indisponível",
    already_accepted: "já aceitou",
    not_active: "complete o cadastro",
    stale_consent: "termo novo",
    removed_by_coordination: "tirada",
    house_locked: "trava",
    house_conflict: "conflito",
    rate_limited: "espere um pouco",
    failed: "não foi possível",
  },
  rateLimitedWait: "Espere {minutes} min.",
};

describe("refusalMessage", () => {
  it("usa o texto do motivo da config", () => {
    expect(refusalMessage(texts, { error: "failed" })).toBe("não foi possível");
    expect(refusalMessage(texts, { error: "stale_consent" })).toBe("termo novo");
  });

  it("limite com tempo restante: mostra os minutos, arredondando para cima", () => {
    expect(refusalMessage(texts, { error: "rate_limited", retryAfterSeconds: 1500 })).toBe("Espere 25 min.");
    expect(refusalMessage(texts, { error: "rate_limited", retryAfterSeconds: 1501 })).toBe("Espere 26 min.");
  });

  it("menos de um minuto restante conta como 1 minuto", () => {
    expect(refusalMessage(texts, { error: "rate_limited", retryAfterSeconds: 5 })).toBe("Espere 1 min.");
  });

  it("limite sem tempo conhecido (ou zero): o texto geral do motivo", () => {
    expect(refusalMessage(texts, { error: "rate_limited" })).toBe("espere um pouco");
    expect(refusalMessage(texts, { error: "rate_limited", retryAfterSeconds: 0 })).toBe("espere um pouco");
  });

  it("o tempo restante só vale para o limite", () => {
    expect(refusalMessage(texts, { error: "failed", retryAfterSeconds: 600 })).toBe("não foi possível");
  });
});
