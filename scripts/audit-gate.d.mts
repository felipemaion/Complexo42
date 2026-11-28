export type AuditException = { id: string; reason: string; reviewBy: string };
export type AuditItem = { package: string; severity: string; advisories: string[] };
export type AuditResult = { blocking: AuditItem[]; excepted: AuditItem[]; reportOnly: AuditItem[]; expired: string[] };
export function parseExceptions(raw: unknown): AuditException[];
export function evaluateAudit(report: unknown, exceptions: readonly AuditException[], today: string): AuditResult;
export function formatSummary(result: AuditResult): string;
