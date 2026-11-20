import type { BadgeIcon } from "../types";

const BADGE_EMOJI_MAP: Record<BadgeIcon, string> = {
  estrela: "⭐",
  trofeu: "🏆",
  fogo: "🔥",
  livro: "📖",
  megafone: "📣",
  camera: "📷",
  coracao: "❤️",
  escudo: "🛡️",
};

export function badgeEmoji(icon: BadgeIcon): string {
  return BADGE_EMOJI_MAP[icon];
}
