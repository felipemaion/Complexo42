"use client";
// Fundo em ondas da entrada "Cinema" (22/11): manchas de luz dourada que se movem devagar e também
// andam com a rolagem. Desenhado em resolução baixa (1/6 da tela) e esticado com desfoque natural:
// barato no celular. Para quando a aba some; com "menos movimento", fica um quadro parado.
import { useEffect, useRef } from "react";
import { parseHexColor, rgba, shade, type Rgb } from "../domain/wave-colors";

const SCALE = 6;
const FRAME_MS = 40;
// Véu escuro por cima das ondas: 0,2 deixa o dourado vivo atrás do título. No ponto mais claro o
// fundo fica perto de rgb(100,80,30); o texto da página sobre as ondas é sempre o claro (text-ink),
// que ali passa de 6:1. Texto apagado (ink-muted) não vai direto sobre as ondas.
const VEIL = 0.2;
const START_DELAY_MS = 600;
const FALLBACK: Rgb = [212, 165, 55];
const CANVAS_FALLBACK: Rgb = [11, 13, 18];

function themeColor(name: string, fallback: Rgb): Rgb {
  return parseHexColor(getComputedStyle(document.documentElement).getPropertyValue(name)) ?? fallback;
}

export function WaveBackdrop() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const gold = themeColor("--color-primary", FALLBACK);
    const light = themeColor("--color-secondary", FALLBACK);
    const base = themeColor("--color-canvas", CANVAS_FALLBACK);
    const deep = shade(gold, 0.65);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let t = 0;
    let last = 0;
    let raf = 0;

    const size = () => {
      canvas.width = Math.max(40, Math.round(window.innerWidth / SCALE));
      canvas.height = Math.max(40, Math.round(window.innerHeight / SCALE));
    };
    const blob = (x: number, y: number, r: number, color: Rgb, alpha: number) => {
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, rgba(color, alpha));
      g.addColorStop(1, rgba(color, 0));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    };
    const draw = () => {
      const { width: w, height: h } = canvas;
      // A rolagem empurra as ondas: a página "acompanha" quem desce (parado com "menos movimento").
      const s = reduce ? 0 : window.scrollY / Math.max(1, window.innerHeight);
      ctx.fillStyle = rgba(base, 1);
      ctx.fillRect(0, 0, w, h);
      blob(w * (0.3 + 0.2 * Math.sin(t + s * 0.6)), h * (0.35 + 0.2 * Math.cos(t * 0.8) - s * 0.12), w * 0.7, gold, 0.55);
      blob(w * (0.75 + 0.15 * Math.cos(t * 1.3 - s * 0.4)), h * (0.7 + 0.15 * Math.sin(t * 0.9)), w * 0.6, deep, 0.6);
      blob(w * (0.55 + 0.25 * Math.sin(t * 0.6 + s)), h * (0.15 + 0.1 * Math.cos(t * 1.7)), w * 0.45, light, 0.25);
      // Véu escuro: o texto por cima continua com contraste alto.
      ctx.fillStyle = rgba(base, VEIL);
      ctx.fillRect(0, 0, w, h);
    };
    const frame = (now: number) => {
      raf = window.requestAnimationFrame(frame);
      if (document.hidden || now - last < FRAME_MS) return;
      last = now;
      t += 0.01;
      draw();
    };
    const onResize = () => {
      size();
      draw();
    };

    size();
    draw();
    window.addEventListener("resize", onResize);
    // O movimento só começa depois que a página terminou de carregar: o primeiro quadro (parado) já
    // está desenhado, e o celular não divide o processador entre a onda e a montagem da página.
    let startTimer = 0;
    const start = () => {
      startTimer = window.setTimeout(() => {
        raf = window.requestAnimationFrame(frame);
      }, START_DELAY_MS);
    };
    if (!reduce) {
      if (document.readyState === "complete") start();
      else window.addEventListener("load", start, { once: true });
    }
    return () => {
      window.clearTimeout(startTimer);
      window.removeEventListener("load", start);
      window.cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  return <canvas ref={ref} aria-hidden="true" className="cine-waves" />;
}
