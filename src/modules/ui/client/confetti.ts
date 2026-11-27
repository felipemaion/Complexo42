// Confete dourado da medalha nova (22/11): uma vez, ~1,5 s, num canvas que some sozinho. Cores do
// tema (lidas das variáveis CSS, nada fixo). Quem pediu ao sistema para reduzir movimento não vê.
// Sem biblioteca e sem worker (a CSP do app não libera blob:). Só para componentes de cliente.

type Piece = { x: number; y: number; vx: number; vy: number; size: number; rot: number; vr: number; color: string };

export function burstConfetti(origin: { x: number; y: number }): void {
  if (typeof window === "undefined") return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const styles = getComputedStyle(document.documentElement);
  const colors = ["--color-primary", "--color-secondary", "--color-ink"].map((v) => styles.getPropertyValue(v).trim()).filter(Boolean);
  if (colors.length === 0) return;

  const canvas = document.createElement("canvas");
  canvas.setAttribute("aria-hidden", "true");
  canvas.style.position = "fixed";
  canvas.style.inset = "0";
  canvas.style.pointerEvents = "none";
  canvas.style.zIndex = "60";
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = window.innerWidth * dpr;
  canvas.height = window.innerHeight * dpr;
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  document.body.appendChild(canvas);
  const g = canvas.getContext("2d");
  if (!g) {
    canvas.remove();
    return;
  }
  g.scale(dpr, dpr);

  const pieces: Piece[] = Array.from({ length: 90 }, () => {
    const angle = -Math.PI / 2 + (Math.random() - 0.5) * 1.4;
    const speed = 7 + Math.random() * 7;
    return {
      x: origin.x, y: origin.y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
      size: 6 + Math.random() * 6, rot: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.3,
      color: colors[Math.floor(Math.random() * colors.length)] ?? colors[0]!,
    };
  });

  const started = performance.now();
  const duration = 1500;
  function frame(now: number): void {
    const t = now - started;
    if (!g) return;
    g.clearRect(0, 0, window.innerWidth, window.innerHeight);
    g.globalAlpha = Math.max(0, 1 - t / duration);
    for (const p of pieces) {
      p.vy += 0.32;
      p.vx *= 0.985;
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vr;
      g.save();
      g.translate(p.x, p.y);
      g.rotate(p.rot);
      g.fillStyle = p.color;
      g.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      g.restore();
    }
    if (t < duration) requestAnimationFrame(frame);
    else canvas.remove();
  }
  requestAnimationFrame(frame);
}
