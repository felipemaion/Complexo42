import "server-only";
import { z } from "zod";
import { TEAMS_PATH } from "../paths";

// Histórico de equipes da pessoa (#69): equipes e porta-vozes por período, só para a coordenação
// (o banco decide). Os nomes vêm cifrados e são decifrados aqui, no servidor.

export type HistoryClient = {
  readonly rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{ readonly data: unknown; readonly error: unknown }>;
};
export type HistoryRow = {
  readonly teamId: string;
  readonly teamName: string;
  readonly joinedAt: string;
  readonly leftAt: string | null;
  readonly spokespeople: readonly string[];
};

/** Caminho da tela de histórico; id que não é uuid volta para a tela de equipes. */
export function historyPath(profileId: unknown): string {
  const parsed = z.guid().safeParse(profileId);
  return parsed.success ? `/coordenacao/historico/${parsed.data}` : TEAMS_PATH;
}

export async function readPersonHistory(
  client: HistoryClient,
  profileId: string,
  decryptName: (value: string, profileId: string) => Promise<string>,
): Promise<readonly HistoryRow[]> {
  const { data, error } = await client.rpc("person_history", { p_profile: profileId });
  if (error) throw new Error("history_read_failed");
  const rows = z
    .array(
      z.object({
        team_id: z.guid(),
        team_name: z.string(),
        joined_at: z.string(),
        left_at: z.string().nullable(),
        spokespeople: z.array(z.object({ profile_id: z.guid(), display_name_enc: z.string() })),
      }),
    )
    .parse(data);
  return Promise.all(
    rows.map(async (row) => ({
      teamId: row.team_id,
      teamName: row.team_name,
      joinedAt: row.joined_at,
      leftAt: row.left_at,
      spokespeople: await Promise.all(
        row.spokespeople.map((s) => decryptName(s.display_name_enc, s.profile_id).catch(() => "—")),
      ),
    })),
  );
}
