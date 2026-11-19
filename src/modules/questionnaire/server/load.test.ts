import { describe, expect, it, vi } from "vitest";
import { instance } from "@config/instance";
import example from "@config/questionnaire.example.json";
import { QuestionnaireConfigError } from "../domain/schema";
import { loadQuestionnaire } from "./load";

const houseIds = instance.houses.map((h) => h.id);

function fieldsOf(fn: () => unknown): string[] {
  try {
    fn();
  } catch (err) {
    if (err instanceof QuestionnaireConfigError) return err.fields;
    throw err;
  }
  return [];
}

describe("loadQuestionnaire", () => {
  it("sem QUESTIONNAIRE_PATH usa o exemplo de config/ e não lê arquivo", () => {
    const read = vi.fn();
    expect(loadQuestionnaire(undefined, read, houseIds).version).toBe(example.version);
    expect(read).not.toHaveBeenCalled();
  });

  it("com QUESTIONNAIRE_PATH lê e valida o arquivo indicado", () => {
    const real = { ...example, version: "real-1" };
    const read = vi.fn(() => JSON.stringify(real));
    expect(loadQuestionnaire("/srv/q.json", read, houseIds).version).toBe("real-1");
    expect(read).toHaveBeenCalledWith("/srv/q.json");
  });

  it("arquivo ilegível falha citando a variável", () => {
    const read = () => {
      throw new Error("ENOENT");
    };
    expect(fieldsOf(() => loadQuestionnaire("/nao/existe.json", read, houseIds))).toEqual(["QUESTIONNAIRE_PATH (arquivo ilegível)"]);
  });

  it("JSON inválido falha sem expor o conteúdo", () => {
    const content = "pergunta secreta {";
    let message = "";
    try {
      loadQuestionnaire("/srv/q.json", () => content, houseIds);
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toContain("QUESTIONNAIRE_PATH (JSON inválido)");
    expect(message).not.toContain("pergunta secreta");
  });

  it("arquivo com campo inválido falha com o nome do campo", () => {
    const read = () => JSON.stringify({ ...example, houseByTemperament: { ...example.houseByTemperament, SJ: "nenhuma" } });
    expect(fieldsOf(() => loadQuestionnaire("/srv/q.json", read, houseIds))).toEqual(["houseByTemperament.SJ"]);
  });
});
