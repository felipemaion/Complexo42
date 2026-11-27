import { describe, expect, it } from "vitest";
import { instance } from "@config/instance";
import example from "@config/questionnaire.example.json";
import { parseQuestionnaire } from "@/modules/questionnaire";
import type { CipherContext, HouseClient, HouseQuery } from "../types";
import { readOwnHouseCard } from "./own-house";

const houseIds = instance.houses.map((house) => house.id);
const [HOUSE_A, HOUSE_B] = houseIds as [string, string];
const questionnaire = parseQuestionnaire(example, houseIds);
const USER = "11111111-1111-4111-8111-111111111111";
const scores = { house1: -40, house2: 75, totem1: 20, totem2: -100 };

const crypto = {
  decrypt: async (value: string, c: CipherContext) => {
    const prefix = `enc[${c.table}.${c.column}.${c.rowId}](`;
    if (!value.startsWith(prefix)) throw new Error("aad_mismatch");
    return value.slice(prefix.length, -1);
  },
};
const encScores = `enc[questionnaire_results.scores_enc.${USER}](${JSON.stringify(scores)})`;

type Response = { data?: unknown; error?: unknown };
function fake(tables: Record<string, Response>) {
  const selected: { table: string; columns: string }[] = [];
  const client: HouseClient = {
    rpc: () => Promise.resolve({ data: null, error: null }),
    from: (table) => ({
      select: (columns) => {
        selected.push({ table, columns });
        const response = { data: tables[table]?.data ?? null, error: tables[table]?.error ?? null };
        const query: HouseQuery = {
          eq: () => query,
          is: () => query,
          not: () => query,
          neq: () => query,
          in: () => query,
          order: () => query,
          limit: () => query,
          maybeSingle: () => Promise.resolve(response),
          then: (ok, fail) => Promise.resolve(response).then(ok, fail),
        };
        return query;
      },
    }),
  };
  return { client, selected };
}
const deps = { crypto, questionnaire, houseIds };

describe("readOwnHouseCard", () => {
  it("sem casa e sem resultado: convite", async () => {
    expect(await readOwnHouseCard(fake({}).client, USER, deps)).toEqual({ kind: "invite" });
  });

  it("com resultado: a casa, o gráfico só dos eixos 1 e 2 e o mapa das casas", async () => {
    const { client } = fake({ questionnaire_results: { data: { house_key: HOUSE_A, scores_enc: encScores } } });
    const card = await readOwnHouseCard(client, USER, deps);
    expect(card).toMatchObject({ kind: "house", houseId: HOUSE_A, isAccepted: false, byPoles: questionnaire.houseByPoles });
    if (card.kind !== "house") return;
    expect(card.chart?.map((axis) => axis.key)).toEqual(["house1", "house2"]);
  });

  it("o totem nunca é pedido ao banco nem aparece no que volta para a pessoa", async () => {
    const { client, selected } = fake({ questionnaire_results: { data: { house_key: HOUSE_A, scores_enc: encScores } } });
    const card = await readOwnHouseCard(client, USER, deps);
    expect(selected.find((s) => s.table === "questionnaire_results")?.columns).not.toMatch(/totem/);
    expect(JSON.stringify(card)).not.toMatch(/totem|Dimensão 3|Dimensão 4/);
  });

  it("com casa aceita, ela vale, e o gráfico do resultado continua", async () => {
    const { client } = fake({
      house_members: { data: { house_key: HOUSE_B } },
      questionnaire_results: { data: { house_key: HOUSE_A, scores_enc: encScores } },
    });
    expect(await readOwnHouseCard(client, USER, deps)).toMatchObject({ houseId: HOUSE_B, isAccepted: true });
  });

  it("notas que não decifram: a casa aparece, sem gráfico (nunca notas de outra pessoa)", async () => {
    const other = `enc[questionnaire_results.scores_enc.22222222-2222-4222-8222-222222222222](${JSON.stringify(scores)})`;
    const { client } = fake({ questionnaire_results: { data: { house_key: HOUSE_A, scores_enc: other } } });
    expect(await readOwnHouseCard(client, USER, deps)).toMatchObject({ kind: "house", houseId: HOUSE_A, chart: null });
  });

  it("resultado de casa que não está na config é ignorado (convite)", async () => {
    const { client } = fake({ questionnaire_results: { data: { house_key: "casa-fantasma", scores_enc: encScores } } });
    expect(await readOwnHouseCard(client, USER, deps)).toEqual({ kind: "invite" });
  });

  it("erro do banco sobe (falha fechado), não vira convite", async () => {
    const { client } = fake({ questionnaire_results: { error: { code: "XX000" } } });
    await expect(readOwnHouseCard(client, USER, deps)).rejects.toThrow();
  });
});
