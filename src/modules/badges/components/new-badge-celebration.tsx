"use client";
// Celebração da medalha nova (22/11): na primeira vez que este navegador vê uma medalha que chegou,
// um aviso em texto (o que importa para leitor de tela e para quem pediu menos movimento) e, quando
// o aviso aparece na tela, confete dourado por ~1,5 s e um acorde curto (se o som estiver ligado).
// O confete espera o aviso ficar visível: no celular a medalha fica longe do topo, e o confete
// disparado na abertura estourava fora da tela (achado no vídeo de 22/11). Depois, silêncio.
import { useEffect, useRef, useState } from "react";
import { burstConfetti } from "@/modules/ui/client/confetti";
import { playSound } from "@/modules/ui/client/sound";
import { takeNewAwards } from "../domain/seen";

const VISIBLE_SHARE = 0.6;

type NewBadgeCelebrationProps = {
  readonly awards: readonly { readonly awardId: string; readonly name: string; readonly awardedAt: string }[];
  /** Texto com {nome}, de config/instance.ts. */
  readonly message: string;
};

export function NewBadgeCelebration({ awards, message }: NewBadgeCelebrationProps) {
  const [text, setText] = useState<string | null>(null);
  const anchor = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    let observer: IntersectionObserver | null = null;
    // Num quadro de animação: a limpeza cancela o quadro, e no modo estrito do React a medalha não é
    // "gasta" pela primeira montagem descartada.
    const frame = window.requestAnimationFrame(() => {
      let store: Storage | null = null;
      try {
        store = window.localStorage;
      } catch {
        store = null;
      }
      const fresh = takeNewAwards(
        awards.map((a) => ({ id: a.awardId, awardedAt: a.awardedAt })),
        store,
      );
      const first = awards.find((a) => fresh.includes(a.awardId));
      const el = anchor.current;
      if (!first || !el) return;
      setText(message.replace("{nome}", first.name));
      observer = new IntersectionObserver(
        (entries) => {
          if (!entries.some((entry) => entry.isIntersecting)) return;
          observer?.disconnect();
          playSound("medal");
          const box = el.getBoundingClientRect();
          burstConfetti({ x: box.left + box.width / 2, y: box.top });
        },
        { threshold: VISIBLE_SHARE },
      );
      observer.observe(el);
    });
    return () => {
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, [awards, message]);

  return (
    <p ref={anchor} aria-live="polite" className={text ? "rounded-xl border-l-4 border-primary bg-soft p-4 text-lg font-bold text-ink" : "sr-only"}>
      {text ?? ""}
    </p>
  );
}
