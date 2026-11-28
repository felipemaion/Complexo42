import { describe, expect, it } from "vitest";
import { isFullName, needsFullNameNotice, stripInvisible } from "./full-name";

const accepted = ["Ana Souza", "Ana Lu", "Maria da Silva", "D'Ávila Pereira", "José-Carlos Souza", "Ana Souza", "Maria J. Silva", "李 小龍"];
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
