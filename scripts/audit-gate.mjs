#!/usr/bin/env node
// Portão do npm audit (#153). Uso: npm audit --omit=dev --json > audit.json || true
//                                  node scripts/audit-gate.mjs audit.json security/npm-audit-exceptions.json
// Reprova SÓ crítico ou alto com correção disponível (critério da #153); o resto vira relatório no
// resumo do job. Exceção é uma por advisory (GHSA), com motivo e data de revisão: vencida, volta a
// reprovar. Relatório com erro (sem rede, registro fora) reprova: "não consegui medir" nunca é "limpo".
import { readFileSync } from "node:fs";

const blockingSeverities = new Set(["high", "critical"]);
/** Motivo de verdade, não "ok" nem "falso positivo": a revisão precisa entender sem perguntar. */
const minReasonChars = 20;
const advisoryId = /^GHSA(-[a-z0-9]{4}){3}$/;
const isoDate = /^\d{4}-\d{2}-\d{2}$/;

/** Valida o arquivo de exceções. Qualquer coisa fora do formato lança (falha fechada). */
export function parseExceptions(raw) {
  if (!Array.isArray(raw)) throw new Error("exceções: o arquivo tem de ser uma lista");
  const seen = new Set();
  return raw.map((entry, index) => {
    const where = `exceções[${index}]`;
    if (typeof entry?.id !== "string" || !advisoryId.test(entry.id)) throw new Error(`${where}: id tem de ser um advisory GHSA`);
    if (typeof entry.reason !== "string" || entry.reason.trim().length < minReasonChars) throw new Error(`${where}: motivo ausente ou curto demais`);
    if (typeof entry.reviewBy !== "string" || !isoDate.test(entry.reviewBy) || Number.isNaN(Date.parse(entry.reviewBy))) {
      throw new Error(`${where}: reviewBy tem de ser uma data AAAA-MM-DD`);
    }
    if (seen.has(entry.id)) throw new Error(`${where}: ${entry.id} repetido`);
    seen.add(entry.id);
    return { id: entry.id, reason: entry.reason, reviewBy: entry.reviewBy };
  });
}

const idFromUrl = (url) => (typeof url === "string" ? url.split("/").pop() : undefined);

/** Separa o relatório em reprova / exceção / só relatório. `today` em AAAA-MM-DD. */
export function evaluateAudit(report, exceptions, today) {
  if (report?.error) throw new Error(`npm audit falhou: ${report.error.code ?? "erro"}`);
  if (report?.auditReportVersion !== 2 || typeof report.vulnerabilities !== "object" || report.vulnerabilities === null) {
    throw new Error("npm audit: relatório em formato desconhecido");
  }
  const valid = new Set(exceptions.filter((e) => e.reviewBy >= today).map((e) => e.id));
  const expired = exceptions.filter((e) => e.reviewBy < today).map((e) => e.id);
  const blocking = [];
  const excepted = [];
  const reportOnly = [];
  for (const [name, vuln] of Object.entries(report.vulnerabilities)) {
    // Só quem TEM o advisory (objeto em `via`); a transitiva (só nomes) aponta para ele.
    const advisories = (vuln.via ?? []).filter((v) => typeof v === "object" && v !== null).map((v) => idFromUrl(v.url) ?? `npm-${v.source}`);
    if (advisories.length === 0) continue;
    const item = { package: name, severity: vuln.severity, advisories };
    const gating = blockingSeverities.has(vuln.severity) && Boolean(vuln.fixAvailable);
    if (!gating) reportOnly.push(item);
    else if (advisories.every((id) => valid.has(id))) excepted.push(item);
    else blocking.push(item);
  }
  return { blocking, excepted, reportOnly, expired };
}

/** Resumo em markdown para o $GITHUB_STEP_SUMMARY. */
export function formatSummary(result) {
  const line = (i) => `| ${i.package} | ${i.severity} | ${i.advisories.join(", ")} |`;
  const table = (title, items) =>
    items.length === 0 ? `**${title}:** nenhum\n` : `**${title}:**\n\n| pacote | severidade | advisories |\n|---|---|---|\n${items.map(line).join("\n")}\n`;
  return [
    "### npm audit (dependências de produção)",
    table("Reprova (alto/crítico com correção)", result.blocking),
    table("Com exceção registrada", result.excepted),
    table("Só relatório", result.reportOnly),
    result.expired.length ? `**Exceções vencidas (revise ou remova):** ${result.expired.join(", ")}\n` : "",
  ].join("\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [reportPath, exceptionsPath] = process.argv.slice(2);
  if (!reportPath || !exceptionsPath) {
    console.error("uso: audit-gate.mjs <audit.json> <exceptions.json>");
    process.exit(2);
  }
  try {
    const result = evaluateAudit(
      JSON.parse(readFileSync(reportPath, "utf8")),
      parseExceptions(JSON.parse(readFileSync(exceptionsPath, "utf8"))),
      new Date().toISOString().slice(0, 10),
    );
    console.log(formatSummary(result));
    process.exit(result.blocking.length > 0 ? 1 : 0);
  } catch (error) {
    console.error(`ERRO: ${error.message}`);
    process.exit(1);
  }
}
