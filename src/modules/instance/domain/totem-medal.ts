/*
 * Medalhas dos totens (public/totens). As imagens são geradas por scripts/otimizar-totens.mjs: quadradas, WebP
 * com PNG de reserva, em 512 e 128 px, com o código do totem em minúsculas no nome do arquivo. O caminho vem do
 * código (conjunto fechado), nunca de texto livre. Só as telas da coordenação as usam: o totem nunca aparece para
 * a pessoa (ADR 0014 §2), e /totens/ fica atrás do login (o proxy não o exclui).
 */
import type { ShieldAssets } from "./house-shield";

/** Os códigos de totem que têm medalha (espada, chama, árvore e barco). */
export const totemMedalCodes: readonly string[] = ["PR", "PA", "AR", "AA"];

/** As imagens da medalha do totem, ou null se o código não tem medalha. */
export function totemMedalAssets(code: string | null): ShieldAssets | null {
  if (code === null || !totemMedalCodes.includes(code)) return null;
  const id = code.toLowerCase();
  return {
    webp512: `/totens/${id}-512.webp`,
    png512: `/totens/${id}-512.png`,
    webp128: `/totens/${id}-128.webp`,
    png128: `/totens/${id}-128.png`,
  };
}
