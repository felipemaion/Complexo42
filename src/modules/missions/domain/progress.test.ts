import { describe, expect, it } from "vitest";
import type { MissionStep, StepSubmission } from "../types";
import { normalizeEvidence, stepProgress, sumLedger, totalPoints } from "./progress";

const step = (position: number, overrides: Partial<MissionStep> = {}): MissionStep => ({
  id: `etapa-${position}`,
  position,
  title: `Etapa ${position}`,
  description: "",
  points: 10 * position,
  evidenceType: "none",
  requiresPrevious: position > 1,
  ...overrides,
});

const submission = (stepId: string, status: StepSubmission["status"], createdAt: string): StepSubmission => ({
  id: `entrega-${stepId}-${createdAt}`,
  stepId,
  status,
  reviewNote: status === "rejected" ? "faltou o link" : null,
  createdAt,
});

describe("stepProgress", () => {
  it("sem execução começada, todas as etapas ficam fechadas", () => {
    // Arrange
    const steps = [step(1), step(2)];

    // Act
    const states = stepProgress(steps, [], false).map((p) => p.state);

    // Assert
    expect(states).toEqual(["locked", "locked"]);
  });

  it("com a execução começada, a 1ª abre e a 2ª espera a 1ª ser validada", () => {
    const states = stepProgress([step(2), step(1)], [], true).map((p) => [p.step.position, p.state]);

    expect(states).toEqual([
      [1, "open"],
      [2, "locked"],
    ]);
  });

  it("entrega pendente fica como pendente; validada libera a próxima", () => {
    const pending = stepProgress([step(1), step(2)], [submission("etapa-1", "submitted", "2026-11-20T10:00:00Z")], true);
    const approved = stepProgress([step(1), step(2)], [submission("etapa-1", "approved", "2026-11-20T10:00:00Z")], true);

    expect(pending.map((p) => p.state)).toEqual(["pending", "locked"]);
    expect(approved.map((p) => p.state)).toEqual(["approved", "open"]);
  });

  it("entrega recusada reabre a etapa e traz o comentário mais recente", () => {
    const progress = stepProgress(
      [step(1)],
      [submission("etapa-1", "rejected", "2026-11-20T09:00:00Z"), submission("etapa-1", "rejected", "2026-11-20T11:00:00Z")],
      true,
    );

    expect(progress[0]?.state).toBe("rejected");
    expect(progress[0]?.latest?.createdAt).toBe("2026-11-20T11:00:00Z");
  });

  it("etapa sem exigência de ordem abre mesmo com a anterior pendente", () => {
    const states = stepProgress([step(1), step(2, { requiresPrevious: false })], [], true).map((p) => p.state);

    expect(states).toEqual(["open", "open"]);
  });
});

describe("pontos", () => {
  it("o valor da missão é a soma das etapas", () => {
    expect(totalPoints([step(1), step(2), step(3)])).toBe(60);
  });

  it("o saldo soma lançamentos e correções negativas", () => {
    expect(sumLedger([{ points: 30 }, { points: 10 }, { points: -5 }])).toBe(35);
  });
});

describe("normalizeEvidence", () => {
  it("link só com https", () => {
    expect(normalizeEvidence("link", { url: " https://exemplo.org/texto " })).toEqual({ url: "https://exemplo.org/texto", text: null });
    expect(normalizeEvidence("link", { url: "http://exemplo.org" })).toBeNull();
  });

  it("protocolo aceita números e barras, recusa texto estranho", () => {
    expect(normalizeEvidence("protocol_number", { text: "PL 123/2026" })).toEqual({ url: null, text: "PL 123/2026" });
    expect(normalizeEvidence("protocol_number", { text: "<script>" })).toBeNull();
  });

  it("texto vazio ou acima de 500 caracteres → recusado", () => {
    expect(normalizeEvidence("text", { text: "   " })).toBeNull();
    expect(normalizeEvidence("text", { text: "a".repeat(501) })).toBeNull();
  });

  it("etapa sem comprovante ignora o que vier do formulário", () => {
    expect(normalizeEvidence("none", { url: "https://x.org", text: "oi" })).toEqual({ url: null, text: null });
  });
});
