// Portão do npm audit (#153): reprova só crítico ou alto COM correção disponível; o resto vira
// relatório. Exceção é uma por advisory, com motivo e data de revisão; vencida, volta a reprovar.
import { describe, expect, it } from "vitest";
import { evaluateAudit, parseExceptions } from "../scripts/audit-gate.mjs";

const advisory = (id: string, severity: string) => ({
  source: 1,
  name: "pacote",
  title: `falha ${id}`,
  url: `https://github.com/advisories/${id}`,
  severity,
});

/** Relatório no formato do `npm audit --json` (auditReportVersion 2). */
function report(vulnerabilities: Record<string, { severity: string; fixAvailable: unknown; via: unknown[] }>) {
  return { auditReportVersion: 2, vulnerabilities, metadata: { vulnerabilities: {} } };
}

const today = "2026-11-28";

describe("evaluateAudit", () => {
  it("alto com correção → reprova", () => {
    const result = evaluateAudit(report({ next: { severity: "high", fixAvailable: true, via: [advisory("GHSA-aaaa-bbbb-cccc", "high")] } }), [], today);
    expect(result.blocking).toEqual([{ package: "next", severity: "high", advisories: ["GHSA-aaaa-bbbb-cccc"] }]);
  });

  it("crítico com correção que exige versão maior (objeto em fixAvailable) → reprova", () => {
    const fix = { name: "next", version: "17.0.0", isSemVerMajor: true };
    const result = evaluateAudit(report({ next: { severity: "critical", fixAvailable: fix, via: [advisory("GHSA-cccc-dddd-eeee", "critical")] } }), [], today);
    expect(result.blocking).toHaveLength(1);
  });

  it("alto sem correção disponível → só relatório", () => {
    const result = evaluateAudit(report({ zod: { severity: "high", fixAvailable: false, via: [advisory("GHSA-aaaa-bbbb-cccc", "high")] } }), [], today);
    expect(result.blocking).toEqual([]);
    expect(result.reportOnly.map((r) => r.package)).toEqual(["zod"]);
  });

  it("moderado ou baixo, mesmo com correção → só relatório", () => {
    const result = evaluateAudit(
      report({
        a: { severity: "moderate", fixAvailable: true, via: [advisory("GHSA-1111-2222-3333", "moderate")] },
        b: { severity: "low", fixAvailable: true, via: [advisory("GHSA-4444-5555-6666", "low")] },
      }),
      [],
      today,
    );
    expect(result.blocking).toEqual([]);
    expect(result.reportOnly).toHaveLength(2);
  });

  it("dependência transitiva (via só com nomes) não conta duas vezes: quem reprova é quem tem o advisory", () => {
    const result = evaluateAudit(
      report({
        postcss: { severity: "high", fixAvailable: true, via: [advisory("GHSA-aaaa-bbbb-cccc", "high")] },
        next: { severity: "high", fixAvailable: true, via: ["postcss"] },
      }),
      [],
      today,
    );
    expect(result.blocking.map((b) => b.package)).toEqual(["postcss"]);
  });

  it("exceção válida cobre o advisory; o caso aparece como exceção, não some", () => {
    const exceptions = [{ id: "GHSA-aaaa-bbbb-cccc", reason: "só alcançável no build, nunca em produção", reviewBy: "2026-12-31" }];
    const result = evaluateAudit(report({ next: { severity: "high", fixAvailable: true, via: [advisory("GHSA-aaaa-bbbb-cccc", "high")] } }), exceptions, today);
    expect(result.blocking).toEqual([]);
    expect(result.excepted).toEqual([{ package: "next", severity: "high", advisories: ["GHSA-aaaa-bbbb-cccc"] }]);
  });

  it("exceção vencida não cobre mais: reprova e diz que venceu", () => {
    const exceptions = [{ id: "GHSA-aaaa-bbbb-cccc", reason: "só alcançável no build, nunca em produção", reviewBy: "2026-11-27" }];
    const result = evaluateAudit(report({ next: { severity: "high", fixAvailable: true, via: [advisory("GHSA-aaaa-bbbb-cccc", "high")] } }), exceptions, today);
    expect(result.blocking).toHaveLength(1);
    expect(result.expired).toEqual(["GHSA-aaaa-bbbb-cccc"]);
  });

  it("exceção de um advisory não cobre outro do mesmo pacote", () => {
    const exceptions = [{ id: "GHSA-aaaa-bbbb-cccc", reason: "só alcançável no build, nunca em produção", reviewBy: "2026-12-31" }];
    const vuln = { severity: "high", fixAvailable: true, via: [advisory("GHSA-aaaa-bbbb-cccc", "high"), advisory("GHSA-zzzz-yyyy-xxxx", "high")] };
    expect(evaluateAudit(report({ next: vuln }), exceptions, today).blocking).toHaveLength(1);
  });

  it("relatório com erro (sem rede, registro fora) → lança: falha fechada, nunca 'zero vulnerabilidades'", () => {
    expect(() => evaluateAudit({ error: { code: "ENOTFOUND", summary: "sem rede" } }, [], today)).toThrow();
    expect(() => evaluateAudit({}, [], today)).toThrow();
  });
});

describe("parseExceptions", () => {
  it("aceita a lista com id, motivo e data", () => {
    const raw = [{ id: "GHSA-aaaa-bbbb-cccc", reason: "só alcançável no build, nunca em produção", reviewBy: "2026-12-31" }];
    expect(parseExceptions(raw)).toEqual(raw);
  });

  it("recusa exceção sem motivo, com motivo curto, sem data, com data inválida ou id que não é advisory", () => {
    const ok = { id: "GHSA-aaaa-bbbb-cccc", reason: "só alcançável no build, nunca em produção", reviewBy: "2026-12-31" };
    for (const bad of [
      { ...ok, reason: undefined },
      { ...ok, reason: "porque sim" },
      { ...ok, reviewBy: undefined },
      { ...ok, reviewBy: "31/12/2026" },
      { ...ok, id: "*" },
    ]) {
      expect(() => parseExceptions([bad])).toThrow();
    }
  });

  it("recusa exceção repetida e o que não é lista (nada de silenciar em massa)", () => {
    const ok = { id: "GHSA-aaaa-bbbb-cccc", reason: "só alcançável no build, nunca em produção", reviewBy: "2026-12-31" };
    expect(() => parseExceptions([ok, ok])).toThrow();
    expect(() => parseExceptions({ ignore: "all" })).toThrow();
  });
});
