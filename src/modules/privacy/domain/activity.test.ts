import { describe, expect, it, vi } from "vitest";
import { activityRowsSchema, buildActivityExport } from "./activity";

const USER = "0b7e28b8-07cb-4f9e-a89c-3fa82944ce26";
const TEAM = "c38bdfae-f1f4-41d6-b8db-41710928a38b";

const rows = {
  badges: [{ name: "Primeira entrega", reason: "Etapa validada", awarded_at: "2026-11-20T10:00:00Z", revoked_at: null, revoked_reason: null }],
  portfolio: [{ title: "Corte", kind: "video", url_enc: "enc-url", created_at: "2026-11-20T10:00:00Z" }],
  points_total: 40,
  points: [{ points: 40, reason: "etapa aprovada", created_at: "2026-11-20T10:00:00Z" }],
  submissions: [{ mission: "Câmara", step: "Protocolar", status: "submitted", evidence_url: null, evidence_text: "PROT 1", review_note: null, created_at: "2026-11-20T10:00:00Z" }],
  team_messages: [{ team_id: TEAM, body_enc: "enc-msg", created_at: "2026-11-20T10:00:00Z" }],
  prior_teams: [{ team_name: "Equipe Saúde", period: "2023", role: "spokesperson", created_at: "2026-11-22T10:00:00Z" }],
};

describe("exportação da atividade (LGPD, depois do #20)", () => {
  it("decifra o link do portfólio e as mensagens com o contexto certo", async () => {
    // Arrange
    const decrypt = vi.fn(async (value: string) => (value === "enc-url" ? "https://youtu.be/x" : "Oi, equipe"));

    // Act
    const out = await buildActivityExport(activityRowsSchema.parse(rows), USER, decrypt, () => {});

    // Assert
    expect(decrypt).toHaveBeenCalledWith("enc-url", { table: "portfolio_items", column: "url_enc", rowId: USER });
    expect(decrypt).toHaveBeenCalledWith("enc-msg", { table: "team_messages", column: "body_enc", rowId: TEAM });
    expect(out.portfolio).toEqual([{ titulo: "Corte", tipo: "video", link: "https://youtu.be/x", criadoEm: "2026-11-20T10:00:00Z" }]);
    expect(out.mensagensDaEquipe).toEqual([{ texto: "Oi, equipe", enviadaEm: "2026-11-20T10:00:00Z" }]);
    expect(out.pontos.total).toBe(40);
    expect(out.medalhas[0]?.motivo).toBe("Etapa validada");
    expect(out.entregas[0]).toMatchObject({ missao: "Câmara", etapa: "Protocolar", comprovanteTexto: "PROT 1" });
    expect(out.equipesAnteriores).toEqual([{ equipe: "Equipe Saúde", quando: "2023", papel: "spokesperson", informadaEm: "2026-11-22T10:00:00Z" }]);
  });

  it("campo que não abre sai como null e só a coluna vai para o aviso", async () => {
    const decrypt = vi.fn(async () => {
      throw new Error("chave errada");
    });
    const warned: string[] = [];

    const out = await buildActivityExport(activityRowsSchema.parse(rows), USER, decrypt, (column) => warned.push(column));

    expect(out.portfolio[0]?.link).toBeNull();
    expect(out.mensagensDaEquipe[0]?.texto).toBeNull();
    expect(warned).toEqual(["portfolio_items.url_enc", "team_messages.body_enc"]);
  });

  it("recusa formato inesperado do banco", () => {
    expect(activityRowsSchema.safeParse({ ...rows, points_total: "muito" }).success).toBe(false);
  });
});
