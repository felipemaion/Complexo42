// Identidade da equipe (#56): catálogo fixo de emblemas (o mesmo do banco, migration
// 20261128000900) e o desenho de cada um. Sem upload de imagem no POC.
export const TEAM_EMBLEMS = ["estrela", "escudo", "tocha", "livro", "megafone", "balanca", "ponte", "folha"] as const;

export type TeamEmblem = (typeof TEAM_EMBLEMS)[number];

export type TeamIdentity = {
  readonly motto: string | null;
  readonly colors: readonly string[];
  readonly emblem: TeamEmblem | null;
};

export const EMBLEM_SYMBOL: Readonly<Record<TeamEmblem, string>> = {
  estrela: "⭐",
  escudo: "🛡️",
  tocha: "🔥",
  livro: "📖",
  megafone: "📣",
  balanca: "⚖️",
  ponte: "🌉",
  folha: "🌿",
};
