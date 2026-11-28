// Liga a tela "Trocar de casa" (#268) ao servidor real: o questionário carregado, as casas da config, o relógio e a cifra. Só
// roda no servidor (a página); nunca recebe nada do navegador além da sessão.
import "server-only";
import { instance } from "@config/instance";
import { decryptField, encryptField } from "@/server/crypto";
import { loadChangeHouse, type ChangeHouseView } from "./change-house";
import { getQuestionnaire } from "./questionnaire";
import type { HouseClient } from "../types";

export async function readChangeHouse(client: HouseClient, userId: string): Promise<ChangeHouseView> {
  try {
    return await loadChangeHouse(client, {
      questionnaire: getQuestionnaire(),
      houseIds: instance.houses.map((h) => h.id),
      userId,
      nowSeconds: Math.floor(Date.now() / 1000),
      encrypt: encryptField,
      decrypt: decryptField,
    });
  } catch {
    // Sem chave de cifra ou erro inesperado: a tela abre só com as casas, sem comparação.
    return {};
  }
}
