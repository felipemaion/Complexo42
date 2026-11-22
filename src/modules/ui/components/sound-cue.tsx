"use client";
// Som de um aviso (22/11): toca uma vez quando o aviso aparece, só se a pessoa ligou o som.
import { useEffect } from "react";
import { playSound, type SoundKind } from "../client/sound";

export function SoundCue({ kind }: { readonly kind: SoundKind }) {
  useEffect(() => {
    playSound(kind);
  }, [kind]);
  return null;
}
