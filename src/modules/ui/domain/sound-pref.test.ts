import { describe, expect, it } from "vitest";
import { takeNewAwards } from "@/modules/badges/domain/seen";
import { readSoundOn, writeSoundOn, type KeyValueStore } from "./sound-pref";

function memoryStore(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}
const broken: KeyValueStore = {
  getItem: () => {
    throw new Error("bloqueado");
  },
  setItem: () => {
    throw new Error("bloqueado");
  },
};

describe("preferência de som", () => {
  it("começa desligado e lembra quando a pessoa liga", () => {
    // Arrange
    const store = memoryStore();

    // Act / Assert
    expect(readSoundOn(store)).toBe(false);
    writeSoundOn(store, true);
    expect(readSoundOn(store)).toBe(true);
    writeSoundOn(store, false);
    expect(readSoundOn(store)).toBe(false);
  });

  it("navegador sem armazenamento: desligado, sem erro", () => {
    expect(readSoundOn(broken)).toBe(false);
    expect(readSoundOn(null)).toBe(false);
    expect(() => writeSoundOn(broken, true)).not.toThrow();
  });
});

describe("medalha nova (celebração uma vez só)", () => {
  const NOW = Date.parse("2026-11-22T12:00:00Z");
  const DAY = 24 * 60 * 60 * 1000;
  const award = (id: string, daysAgo: number) => ({ id, awardedAt: new Date(NOW - daysAgo * DAY).toISOString() });

  it("sem medalha nenhuma, nada é gravado no aparelho (ADR 0008: nada da pessoa fica no navegador à toa)", () => {
    // Arrange
    const store = memoryStore();

    // Act
    const fresh = takeNewAwards([], store, NOW);

    // Assert
    expect(fresh).toEqual([]);
    expect(store.data.size).toBe(0);
  });

  it("primeira vez neste aparelho: celebra só a que chegou nos últimos 7 dias; as antigas não", () => {
    const store = memoryStore();

    expect(takeNewAwards([award("antiga", 30), award("nova", 1)], store, NOW)).toEqual(["nova"]);
    expect(takeNewAwards([award("antiga", 30), award("nova", 1)], store, NOW)).toEqual([]);
  });

  it("a primeira medalha da vida, recém-chegada, ganha festa (antes não havia nada guardado)", () => {
    const store = memoryStore();
    takeNewAwards([], store, NOW);

    expect(takeNewAwards([award("primeira", 0)], store, NOW)).toEqual(["primeira"]);
  });

  it("depois, só as que chegaram de novo, e uma vez", () => {
    const store = memoryStore();
    takeNewAwards([award("a", 20)], store, NOW);

    expect(takeNewAwards([award("a", 20), award("c", 30)], store, NOW)).toEqual(["c"]);
    expect(takeNewAwards([award("a", 20), award("c", 30)], store, NOW)).toEqual([]);
  });

  it("data estranha não quebra: só não conta como recente", () => {
    const store = memoryStore();

    expect(takeNewAwards([{ id: "x", awardedAt: "ontem" }], store, NOW)).toEqual([]);
  });

  it("armazenamento quebrado ou estranho: nada a celebrar", () => {
    const store = memoryStore();
    store.data.set("c42-medalhas-vistas", "{nao é lista");

    expect(takeNewAwards([award("a", 0)], broken, NOW)).toEqual([]);
    expect(takeNewAwards([award("a", 0)], store, NOW)).toEqual([]);
  });
});
