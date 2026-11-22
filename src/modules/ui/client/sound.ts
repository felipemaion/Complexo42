// Sons da interface (22/11): gerados pelo navegador (Web Audio), sem arquivo e sem rede, então a CSP
// não muda. Desligados até a pessoa ligar (botão no cabeçalho). O contexto de áudio só é criado ou
// retomado durante um toque, como os navegadores exigem; nada toca sozinho (WCAG 1.4.2).
// Só para componentes de cliente.

export type SoundKind = "tap" | "ok" | "error" | "medal";

let ctx: AudioContext | null = null;
let enabled = false;

function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

export function setSoundEnabled(on: boolean): void {
  enabled = on;
}

export function isSoundEnabled(): boolean {
  return enabled;
}

/** Chamar dentro de um toque (clique): libera o áudio para os sons seguintes. */
export function unlockSound(): void {
  if (enabled) audio();
}

function tone(c: AudioContext, freq: number, duration: number, options: { type?: OscillatorType; gain?: number; to?: number; delay?: number } = {}): void {
  const start = c.currentTime + (options.delay ?? 0);
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = options.type ?? "sine";
  osc.frequency.setValueAtTime(freq, start);
  if (options.to) osc.frequency.exponentialRampToValueAtTime(options.to, start + duration);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(options.gain ?? 0.05, start + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  osc.connect(gain);
  gain.connect(c.destination);
  osc.start(start);
  osc.stop(start + duration + 0.03);
}

export function playSound(kind: SoundKind): void {
  if (!enabled) return;
  const c = audio();
  if (!c) return;
  if (kind === "tap") tone(c, 760, 0.07, { type: "triangle", gain: 0.04, to: 520 });
  if (kind === "ok") {
    tone(c, 660, 0.12, { gain: 0.045 });
    tone(c, 990, 0.18, { gain: 0.04, delay: 0.08 });
  }
  if (kind === "error") tone(c, 300, 0.22, { type: "triangle", gain: 0.05, to: 220 });
  if (kind === "medal") [784, 988, 1175, 1568].forEach((f, i) => tone(c, f, 0.7, { gain: 0.045, delay: i * 0.09 }));
}
