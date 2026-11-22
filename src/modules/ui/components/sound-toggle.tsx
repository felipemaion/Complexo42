"use client";
// Botão de som do cabeçalho (22/11): desligado até a pessoa ligar; a escolha fica neste navegador.
// Com o som ligado, todo toque em botão ou link faz um clique curto. Alvo de 48 px.
import { useEffect, useSyncExternalStore } from "react";
import { playSound, setSoundEnabled, unlockSound } from "../client/sound";
import { readSoundOn, writeSoundOn } from "../domain/sound-pref";

type SoundToggleProps = {
  readonly onLabel: string;
  readonly offLabel: string;
};

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

// A escolha vive no localStorage (fonte externa): useSyncExternalStore lê sem efeito e, no servidor,
// começa desligado. A troca em outra aba chega pelo evento "storage".
const listeners = new Set<() => void>();
function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}
const readSaved = (): boolean => readSoundOn(storage());
const readOnServer = (): boolean => false;

export function SoundToggle({ onLabel, offLabel }: SoundToggleProps) {
  const isOn = useSyncExternalStore(subscribe, readSaved, readOnServer);

  useEffect(() => {
    setSoundEnabled(isOn);
  }, [isOn]);

  useEffect(() => {
    // Um ouvinte só para o site todo: clique em botão ou link toca o "tap" (se o som estiver ligado).
    const onClick = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target.closest("button, a[href]") : null;
      if (!target || target.hasAttribute("data-sound-toggle")) return;
      unlockSound();
      playSound("tap");
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  const toggle = () => {
    const next = !isOn;
    setSoundEnabled(next);
    writeSoundOn(storage(), next);
    listeners.forEach((notify) => notify());
    if (next) {
      unlockSound();
      playSound("ok");
    }
  };

  return (
    <button
      type="button"
      data-sound-toggle=""
      aria-pressed={isOn}
      onClick={toggle}
      className={`inline-flex min-h-12 items-center gap-2 rounded-full border-2 px-4 text-lg font-bold transition-[transform,background-color] duration-150 active:scale-95 motion-reduce:transform-none ${
        isOn ? "border-primary bg-primary text-on-primary" : "border-line bg-transparent text-primary"
      }`}
    >
      <span aria-hidden="true" className="inline-flex h-4 items-end gap-0.5">
        <span className={`w-1 rounded-full bg-current ${isOn ? "h-4 animate-pulse motion-reduce:animate-none" : "h-1.5"}`} />
        <span className={`w-1 rounded-full bg-current ${isOn ? "h-2.5 animate-pulse motion-reduce:animate-none" : "h-1.5"}`} />
        <span className={`w-1 rounded-full bg-current ${isOn ? "h-3.5 animate-pulse motion-reduce:animate-none" : "h-1.5"}`} />
      </span>
      {isOn ? onLabel : offLabel}
    </button>
  );
}
