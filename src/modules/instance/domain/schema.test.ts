import { describe, expect, it } from "vitest";
import { instance } from "@config/instance";
import { InstanceConfigError, parseInstanceConfig, roleKeys } from "./schema";

const valid = {
  name: "Nome",
  shortName: "Curto",
  colors: { primary: "#000000", secondary: "#FFFFFF" },
  roleLabels: Object.fromEntries(roleKeys.map((k) => [k, `rótulo ${k}`])),
  home: { title: "Título", message: "Mensagem" },
  waitlist: { title: "Espera", message: "Mensagem de espera" },
  houses: [
    { id: "a", name: "A", description: "d", firstSteps: { text: "t", videoUrls: ["https://v.example/1"] } },
    { id: "b", name: "B", description: "d", firstSteps: { text: "t" } },
  ],
};

function fieldsOf(raw: unknown): string[] {
  try {
    parseInstanceConfig(raw);
  } catch (error) {
    expect(error).toBeInstanceOf(InstanceConfigError);
    return (error as InstanceConfigError).fields;
  }
  throw new Error("esperava InstanceConfigError");
}

describe("parseInstanceConfig", () => {
  it("aceita uma configuração válida e preenche os vídeos ausentes", () => {
    const config = parseInstanceConfig(valid);
    expect(config.houses[1]?.firstSteps.videoUrls).toEqual([]);
    expect(Object.isFrozen(config)).toBe(true);
  });

  it("config/instance.ts é válida e tem rótulo para todo papel genérico", () => {
    for (const key of roleKeys) expect(instance.roleLabels[key]).toMatch(/\S/);
    expect(instance.houses.length).toBeGreaterThan(0);
  });

  it("falha citando os campos inválidos, sem expor os valores", () => {
    const raw = {
      ...valid,
      name: "  ",
      colors: { primary: "VALOR-SECRETO", secondary: "#fff" },
      roleLabels: { ...valid.roleLabels, manager: undefined },
    };
    let message = "";
    try {
      parseInstanceConfig(raw);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(fieldsOf(raw)).toEqual(["name", "colors.primary", "colors.secondary", "roleLabels.manager"]);
    expect(message).toContain("colors.primary");
    expect(message).not.toContain("VALOR-SECRETO");
  });

  it("recusa campo desconhecido, papel fora da lista e lista de casas vazia", () => {
    expect(fieldsOf({ ...valid, extra: 1 })).toEqual(["(raiz)"]);
    expect(fieldsOf({ ...valid, roleLabels: { ...valid.roleLabels, student: "x" } })).toEqual(["roleLabels"]);
    expect(fieldsOf({ ...valid, houses: [] })).toEqual(["houses"]);
    expect(fieldsOf({ ...valid, waitlist: { title: "Espera", message: " " } })).toEqual(["waitlist.message"]);
  });

  it("recusa id de casa repetido, id fora do padrão e vídeo sem https", () => {
    const [a, b] = valid.houses;
    expect(fieldsOf({ ...valid, houses: [a, { ...b, id: "a" }] })).toEqual(["houses.1.id"]);
    expect(fieldsOf({ ...valid, houses: [{ ...a, id: "Casa A" }] })).toEqual(["houses.0.id"]);
    expect(
      fieldsOf({ ...valid, houses: [{ ...a, firstSteps: { text: "t", videoUrls: ["http://v.example/1"] } }] }),
    ).toEqual(["houses.0.firstSteps.videoUrls.0"]);
  });
});
