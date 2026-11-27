"use client";
// Botão de som do cabeçalho (22/11): desligado até a pessoa ligar; a escolha fica neste navegador.
// Com o som ligado, todo toque em botão ou link faz um clique curto. Alvo de 48 px.
// Rótulo curto ("Som"); o estado aparece no ícone (alto-falante com ondas ou riscado), no fundo
// dourado e, para leitor de tela, em aria-pressed.
import { useEffect, useSyncExternalStore } from "react";
import { playSound, setSoundEnabled, unlockSound } from "../client/sound";
import { readSoundOn, writeSoundOn } from "../domain/sound-pref";

type SoundToggleProps = {
  readonly label: string;
  /** No celular, só o ícone à vista (o nome continua para leitor de tela). */
  readonly isCompactOnPhone?: boolean;
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

function SpeakerIcon({ isOn }: { readonly isOn: boolean }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor" />
      {isOn ? (
        <>
          <path d="M15.5 9a4 4 0 0 1 0 6" />
          <path d="M18.5 6.5a7.5 7.5 0 0 1 0 11" />
        </>
      ) : (
        <path d="M16 9.5l5 5M21 9.5l-5 5" />
      )}
    </svg>
  );
}

export function SoundToggle({ label, isCompactOnPhone = false }: SoundToggleProps) {
  const isOn = useSyncExternalStore(subscribe, readSaved, readOnServer);

  useEffect(() => {
    setSoundEnabled(isOn);
  }, [isOn]);

  useEffect(() => {
    // Um ouvinte só para o site todo: clique em botão, link ou item que abre toca o "tap".
    const onClick = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target.closest("button, a[href], summary") : null;
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
      className={`inline-flex min-h-12 min-w-12 items-center justify-center gap-2 rounded-full border-2 ${isCompactOnPhone ? "px-2 sm:px-4" : "px-4"} text-lg font-bold transition-[transform,background-color] duration-150 active:scale-95 motion-reduce:transform-none ${
        isOn ? "border-primary bg-primary text-on-primary" : "border-line bg-transparent text-primary"
      }`}
    >
      <SpeakerIcon isOn={isOn} />
      <span className={isCompactOnPhone ? "max-sm:sr-only" : undefined}>{label}</span>
    </button>
  );
}
