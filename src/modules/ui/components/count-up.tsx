"use client";
// Número grande que conta de 0 até o valor (22/11), uma vez. O valor certo vai sempre para leitor de
// tela (texto escondido) e aparece direto para quem pediu menos movimento. Para não piscar
// ("40" do servidor → "0" → conta), o número visível nasce escondido (globals.css, .c42-count) até a
// contagem começar; se o script não rodar, ele aparece sozinho em 1,5 s.
import { useEffect, useRef } from "react";
import { easedCount } from "../domain/count";

const DURATION_MS = 1000;

export function CountUp({ value }: { readonly value: number }) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const final = String(value);
    const done = () => {
      el.textContent = final;
      el.dataset.state = "done";
    };
    if (value <= 0 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      done();
      return;
    }
    el.textContent = "0";
    el.dataset.state = "run";
    let raf = 0;
    const start = performance.now();
    const step = (now: number) => {
      const t = (now - start) / DURATION_MS;
      el.textContent = String(easedCount(value, t));
      if (t < 1) raf = window.requestAnimationFrame(step);
      else done();
    };
    raf = window.requestAnimationFrame(step);
    return () => {
      window.cancelAnimationFrame(raf);
      done();
    };
  }, [value]);

  return (
    <>
      <span className="sr-only">{value}</span>
      <span ref={ref} aria-hidden="true" className="c42-count" data-state="idle">
        {value}
      </span>
    </>
  );
}
