import { describe, expect, it } from "vitest";
import { easedCount } from "./count";

describe("número que conta até o valor", () => {
  it("começa em 0, termina exatamente no valor e nunca passa dele", () => {
    // Act
    const frames = [0, 0.25, 0.5, 0.75, 1].map((t) => easedCount(120, t));

    // Assert
    expect(frames[0]).toBe(0);
    expect(frames[4]).toBe(120);
    expect(frames.every((v) => v >= 0 && v <= 120)).toBe(true);
    expect(frames).toEqual([...frames].sort((a, b) => a - b));
  });

  it("acelera no começo (sai rápido, chega devagar)", () => {
    expect(easedCount(100, 0.5)).toBeGreaterThan(50);
  });

  it("tempo fora de 0 a 1 e valor negativo ou quebrado não fazem número estranho", () => {
    expect(easedCount(100, -1)).toBe(0);
    expect(easedCount(100, 2)).toBe(100);
    expect(easedCount(-5, 0.5)).toBe(0);
    expect(easedCount(Number.NaN, 0.5)).toBe(0);
  });
});
