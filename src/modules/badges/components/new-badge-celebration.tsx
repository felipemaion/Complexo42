"use client";
// Celebração da medalha nova (22/11): na primeira vez que este navegador vê uma medalha que chegou,
// confete dourado por ~1,5 s, um acorde curto (se o som estiver ligado) e um aviso em texto, que é o
// que importa para quem usa leitor de tela ou pediu menos movimento. Depois, silêncio.
import { useEffect, useRef, useState } from "react";
import { burstConfetti } from "@/modules/ui/client/confetti";
import { playSound } from "@/modules/ui/client/sound";
import { takeNewAwards } from "../domain/seen";

type NewBadgeCelebrationProps = {
  readonly awards: readonly { readonly awardId: string; readonly name: string }[];
  /** Texto com {nome}, de config/instance.ts. */
  readonly message: string;
};

export function NewBadgeCelebration({ awards, message }: NewBadgeCelebrationProps) {
  const [text, setText] = useState<string | null>(null);
  const anchor = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    // Tudo num quadro de animação: o confete precisa da posição já desenhada, e a limpeza cancela o
    // quadro (no modo estrito do React a medalha não é "gasta" pela primeira montagem descartada).
    const frame = window.requestAnimationFrame(() => {
      let store: Storage | null = null;
      try {
        store = window.localStorage;
      } catch {
        store = null;
      }
      const fresh = takeNewAwards(awards.map((a) => a.awardId), store);
      const first = awards.find((a) => fresh.includes(a.awardId));
      if (!first) return;
      setText(message.replace("{nome}", first.name));
      playSound("medal");
      const box = anchor.current?.getBoundingClientRect();
      burstConfetti(box ? { x: box.left + box.width / 2, y: box.top } : { x: window.innerWidth / 2, y: window.innerHeight / 3 });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [awards, message]);

  return (
    <p ref={anchor} aria-live="polite" className={text ? "rounded-xl border-l-4 border-primary bg-soft p-4 text-lg font-bold text-ink" : "sr-only"}>
      {text ?? ""}
    </p>
  );
}
