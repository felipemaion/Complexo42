/*
 * Escudos das casas e logo do app (public/casas). As imagens são geradas por
 * scripts/otimizar-escudos.mjs: quadradas, WebP com PNG de reserva, em 512 e 128 px. O caminho vem
 * do id da casa (config), nunca de texto livre. O app não é uma casa: o escudo dela é o
 * logo do app (ícone, cabeçalho e entrada); ninguém "pertence" a ela.
 */

export type ShieldAssets = { webp512: string; png512: string; webp128: string; png128: string };

const safeId = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function assetsOf(id: string): ShieldAssets {
  if (!safeId.test(id)) throw new Error("shield_id_invalid");
  return {
    webp512: `/casas/${id}-512.webp`,
    png512: `/casas/${id}-512.png`,
    webp128: `/casas/${id}-128.webp`,
    png128: `/casas/${id}-128.png`,
  };
}

/** As imagens do escudo de uma casa da config. */
export function shieldAssets(houseId: string): ShieldAssets {
  return assetsOf(houseId);
}

/** O logo do app (escudo do app). */
export function appLogo(): ShieldAssets {
  return assetsOf("app-logo");
}
