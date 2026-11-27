// Limitador simples por chave (janela fixa, em memória do processo). Serve para frear uso
// repetido de uma ação sensível por uma mesma pessoa; não substitui o limite da borda. Cada
// réplica conta sozinha, o que basta para o objetivo (impedir rajada de um coordenador).
export type RateLimiter = {
  /** Registra um uso da chave; false se já passou do máximo na janela. */
  take(key: string): boolean;
  /** Só para teste: quantas chaves estão guardadas. */
  size(): number;
  /** Só para teste: esquece tudo. */
  reset(): void;
};

export function createRateLimiter({
  max,
  windowMs,
  now = Date.now,
  maxKeys = 10_000,
}: {
  max: number;
  windowMs: number;
  now?: () => number;
  maxKeys?: number;
}): RateLimiter {
  const windows = new Map<string, { start: number; count: number }>();

  const sweep = (at: number) => {
    for (const [key, w] of windows) if (at - w.start >= windowMs) windows.delete(key);
    // Ainda cheio (tudo dentro da janela): descarta as mais antigas, que são as primeiras inseridas.
    for (const key of windows.keys()) {
      if (windows.size < maxKeys) break;
      windows.delete(key);
    }
  };

  return {
    take(key) {
      const at = now();
      const current = windows.get(key);
      if (!current || at - current.start >= windowMs) {
        if (windows.size >= maxKeys) sweep(at);
        windows.set(key, { start: at, count: 1 });
        return true;
      }
      if (current.count >= max) return false;
      current.count += 1;
      return true;
    },
    size: () => windows.size,
    reset: () => windows.clear(),
  };
}
