import { describe, expect, it } from "vitest";
import { formatLockDate, houseLockNotice } from "./house-lock";

const template = "Você poderá trocar de casa a partir de {date}.";
const now = new Date("2026-11-27T12:00:00Z");

describe("houseLockNotice", () => {
  it("antes do prazo, mostra a data a partir da qual a pessoa poderá trocar", () => {
    expect(houseLockNotice(template, "2027-03-27T15:00:00Z", now)).toBe("Você poderá trocar de casa a partir de 27/03/2027.");
  });

  it("no instante do prazo e depois dele não há aviso (a pessoa já pode trocar)", () => {
    expect(houseLockNotice(template, "2026-11-27T12:00:00Z", now)).toBeNull();
    expect(houseLockNotice(template, "2026-01-01T00:00:00Z", now)).toBeNull();
  });

  it("sem trava lida (sem casa aceita), não há aviso", () => {
    expect(houseLockNotice(template, null, now)).toBeNull();
  });

  it("data inválida não vira aviso nem quebra a tela", () => {
    expect(houseLockNotice(template, "não é data", now)).toBeNull();
  });
});

describe("formatLockDate", () => {
  it("usa o dia de Brasília, não o do servidor (UTC)", () => {
    expect(formatLockDate("2027-03-28T01:30:00Z")).toBe("27/03/2027");
    expect(formatLockDate("2027-03-28T03:00:00Z")).toBe("28/03/2027");
  });
});
