import "server-only";
import { z } from "zod";
import type { CollabClient } from "../types";

// Placar de equipes por período (#58, ADR 0006 §6): só equipes, nunca pessoas. Quem pode ver o
// banco decide (team_scoreboard: quem está na região ou a coordena).

export const SCOREBOARD_PATH = "/placar";
export const SCOREBOARD_PERIODS = [7, 30, 90] as const;

export type ScoreboardRow = { readonly teamId: string; readonly teamName: string; readonly points: number; readonly isMine: boolean; readonly position: number };

/** Período da URL: só os da tela; qualquer outro valor vira "desde o início" (null). */
export function parsePeriod(raw: unknown): number | null {
  const value = Number(raw);
  return (SCOREBOARD_PERIODS as readonly number[]).includes(value) ? value : null;
}

export async function readScoreboard(client: CollabClient, days: number | null): Promise<readonly ScoreboardRow[]> {
  const { data, error } = await client.rpc("team_scoreboard", { p_scope: null, p_days: days });
  if (error) throw new Error("scoreboard_read_failed");
  const rows = z.array(z.object({ team_id: z.guid(), team_name: z.string(), points: z.number(), is_mine: z.boolean() })).parse(data);
  // Posição de competição: empate divide a posição (1, 1, 3). A lista já vem em ordem de pontos.
  return rows.map((row) => ({
    teamId: row.team_id,
    teamName: row.team_name,
    points: row.points,
    isMine: row.is_mine,
    position: rows.findIndex((other) => other.points === row.points) + 1,
  }));
}
