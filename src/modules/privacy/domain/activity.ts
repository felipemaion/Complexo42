// "Baixar meus dados" (#20, LGPD art. 18, II): a parte da atividade (medalhas, portfólio, pontos,
// entregas, mensagens da equipe), que vem de `public.export_own_activity()`. Regra pura: valida o
// formato, decifra com o mesmo contexto da gravação e devolve a seção do arquivo, com nomes em
// português como o resto do arquivo. Campo que não abre sai null (e só a coluna vai para o log).
import { z } from "zod";
import type { DecryptFn } from "./export";

const when = z.string();

export const activityRowsSchema = z.object({
  badges: z.array(
    z.object({ name: z.string(), reason: z.string(), awarded_at: when, revoked_at: when.nullable(), revoked_reason: z.string().nullable() }),
  ),
  portfolio: z.array(z.object({ title: z.string(), kind: z.string(), url_enc: z.string(), created_at: when })),
  points_total: z.number(),
  points: z.array(z.object({ points: z.number(), reason: z.string(), created_at: when })),
  submissions: z.array(
    z.object({
      mission: z.string(),
      step: z.string(),
      status: z.string(),
      evidence_url: z.string().nullable(),
      evidence_text: z.string().nullable(),
      review_note: z.string().nullable(),
      created_at: when,
    }),
  ),
  team_messages: z.array(z.object({ team_id: z.guid(), body_enc: z.string(), created_at: when })),
});

export type ActivityRows = z.infer<typeof activityRowsSchema>;

export type ActivityExport = {
  medalhas: { nome: string; motivo: string; recebidaEm: string; revogadaEm: string | null; motivoDaRevogacao: string | null }[];
  portfolio: { titulo: string; tipo: string; link: string | null; criadoEm: string }[];
  pontos: { total: number; lancamentos: { pontos: number; motivo: string; em: string }[] };
  entregas: {
    missao: string;
    etapa: string;
    situacao: string;
    comprovanteLink: string | null;
    comprovanteTexto: string | null;
    comentarioDaCoordenacao: string | null;
    enviadaEm: string;
  }[];
  mensagensDaEquipe: { texto: string | null; enviadaEm: string }[];
};

export async function buildActivityExport(
  rows: ActivityRows,
  userId: string,
  decrypt: DecryptFn,
  onDecryptError: (column: string) => void,
): Promise<ActivityExport> {
  const open = async (value: string, table: string, column: string, rowId: string): Promise<string | null> => {
    try {
      return await decrypt(value, { table, column, rowId });
    } catch {
      onDecryptError(`${table}.${column}`);
      return null;
    }
  };

  const portfolio = [];
  for (const item of rows.portfolio) {
    portfolio.push({ titulo: item.title, tipo: item.kind, link: await open(item.url_enc, "portfolio_items", "url_enc", userId), criadoEm: item.created_at });
  }
  const mensagensDaEquipe = [];
  for (const message of rows.team_messages) {
    mensagensDaEquipe.push({ texto: await open(message.body_enc, "team_messages", "body_enc", message.team_id), enviadaEm: message.created_at });
  }

  return {
    medalhas: rows.badges.map((b) => ({ nome: b.name, motivo: b.reason, recebidaEm: b.awarded_at, revogadaEm: b.revoked_at, motivoDaRevogacao: b.revoked_reason })),
    portfolio,
    pontos: { total: rows.points_total, lancamentos: rows.points.map((p) => ({ pontos: p.points, motivo: p.reason, em: p.created_at })) },
    entregas: rows.submissions.map((s) => ({
      missao: s.mission,
      etapa: s.step,
      situacao: s.status,
      comprovanteLink: s.evidence_url,
      comprovanteTexto: s.evidence_text,
      comentarioDaCoordenacao: s.review_note,
      enviadaEm: s.created_at,
    })),
    mensagensDaEquipe,
  };
}
