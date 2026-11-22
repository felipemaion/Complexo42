"use client";
// Número grande que conta de 0 até o valor (22/11), uma vez ao aparecer. O servidor já entrega o
// valor final (sem "pulo" e certo para leitor de tela e para quem pediu menos movimento); a contagem
// só muda o texto visível por ~1 s e termina no mesmo número.
import { useEffect, useRef } from "react";
import { easedCount } from "../domain/count";

const DURATION_MS = 1000;

export function CountUp({ value }: { readonly value: number }) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || value <= 0 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const final = String(value);
    let raf = 0;
    const start = performance.now();
    const step = (now: number) => {
      const t = (now - start) / DURATION_MS;
      el.textContent = String(easedCount(value, t));
      if (t < 1) raf = window.requestAnimationFrame(step);
    };
    raf = window.requestAnimationFrame(step);
    return () => {
      window.cancelAnimationFrame(raf);
      el.textContent = final;
    };
  }, [value]);

  return <span ref={ref}>{value}</span>;
}
