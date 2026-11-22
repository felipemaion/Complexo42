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
  it("primeira visita: nada a celebrar, mas guarda o que viu", () => {
    const store = memoryStore();

    expect(takeNewAwards(["a", "b"], store)).toEqual([]);
    expect(takeNewAwards(["a", "b"], store)).toEqual([]);
  });

  it("depois, só as que chegaram de novo, e uma vez", () => {
    const store = memoryStore();
    takeNewAwards(["a"], store);

    expect(takeNewAwards(["a", "c"], store)).toEqual(["c"]);
    expect(takeNewAwards(["a", "c"], store)).toEqual([]);
  });

  it("armazenamento quebrado ou estranho: nada a celebrar", () => {
    const store = memoryStore();
    store.data.set("c42-medalhas-vistas", "{nao é lista");

    expect(takeNewAwards(["a"], broken)).toEqual([]);
    expect(takeNewAwards(["a"], store)).toEqual([]);
  });
});
