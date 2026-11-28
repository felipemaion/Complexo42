import { describe, expect, it } from "vitest";
import { firstName, isFullName, needsFullNameNotice, stripInvisible } from "./full-name";

const accepted = ["Ana Souza", "Ana Lu", "Maria da Silva", "D'Ávila Pereira", "José-Carlos Souza", "Ana Souza", "Maria J. Silva"];
const rejected = ["", "Ana", "a b", "1 2", "- -", "😀 😀", "Ana 12", "Ana J.", "Ana-Maria", "Ana ​", "Ana​Souza"];

describe("nome completo (issue #312)", () => {
  it.each(accepted)("aceita %j", (name) => expect(isFullName(name)).toBe(true));
  it.each(rejected)("recusa %j", (name) => expect(isFullName(name)).toBe(false));

  it("tira os caracteres invisíveis (ZWSP, ZWJ, BOM) e mantém o resto", () => {
    expect(stripInvisible("A​n‍a﻿ Souza")).toBe("Ana Souza");
  });

  it("o aviso só aparece para nome lido e de uma palavra, nunca para nome ilegível (vazio)", () => {
    expect(needsFullNameNotice("Maria")).toBe(true);
    expect(needsFullNameNotice("Maria Souza")).toBe(false);
    expect(needsFullNameNotice("")).toBe(false);
  });
});

describe("primeiro nome na saudação do início (#324)", () => {
  it("devolve a primeira palavra do nome", () => {
    expect(firstName("Maria da Silva")).toBe("Maria");
    expect(firstName("  Ana Lu ")).toBe("Ana");
  });

  it("ignora caracteres invisíveis antes do nome", () => {
    expect(firstName("​João Souza")).toBe("João");
  });

  it("nome vazio ou ilegível (decifra falhou) → sem nome, e a página usa o título genérico", () => {
    expect(firstName("")).toBeNull();
    expect(firstName("   ")).toBeNull();
    expect(firstName("- -")).toBeNull();
  });
});
