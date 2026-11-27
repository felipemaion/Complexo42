import { describe, expect, it } from "vitest";
import { createRateLimiter } from "./rate-limit";

describe("createRateLimiter (janela fixa por chave)", () => {
  it("deixa passar até o máximo na janela e barra o excedente, por chave", () => {
    const now = 0;
    const limiter = createRateLimiter({ max: 3, windowMs: 1000, now: () => now });
    expect([1, 2, 3, 4].map(() => limiter.take("a"))).toEqual([true, true, true, false]);
    expect(limiter.take("b")).toBe(true);
  });

  it("a janela vence e a contagem recomeça", () => {
    let now = 0;
    const limiter = createRateLimiter({ max: 1, windowMs: 1000, now: () => now });
    expect(limiter.take("a")).toBe(true);
    expect(limiter.take("a")).toBe(false);
    now = 1001;
    expect(limiter.take("a")).toBe(true);
  });

  it("não cresce sem fim: chaves vencidas são esquecidas", () => {
    let now = 0;
    const limiter = createRateLimiter({ max: 1, windowMs: 10, now: () => now, maxKeys: 5 });
    for (let i = 0; i < 20; i++) {
      now += 11;
      limiter.take(`k${i}`);
    }
    expect(limiter.size()).toBeLessThanOrEqual(5);
  });
});
