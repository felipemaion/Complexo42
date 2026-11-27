/*
 * Templates de e-mail do login (GoTrue) em português. O app os serve em rotas públicas e estáticas
 * (/emails/<nome>, sem sessão e sem dado pessoal) e o GoTrue os busca pela rede interna. As variáveis do
 * GoTrue ({{ .ConfirmationURL }}, {{ .NewEmail }}) ficam intactas; texto e nome do app vêm da config da
 * instância. HTML de e-mail simples: sem JavaScript, sem imagem nem recurso externo, sem marca de terceiros.
 */
import type { InstanceConfig } from "@/modules/instance";

export const emailTemplateKinds = ["magic-link", "confirmation", "recovery", "invite", "email-change"] as const;
export type EmailTemplateKind = (typeof emailTemplateKinds)[number];

export function isEmailTemplateKind(value: unknown): value is EmailTemplateKind {
  return typeof value === "string" && (emailTemplateKinds as readonly string[]).includes(value);
}

const escapes: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => escapes[char]!);
}

const LINK = "{{ .ConfirmationURL }}";

/** O HTML de um template. `config` é a instância (só `name` e `emails` são usados). */
export function renderEmailTemplate(kind: EmailTemplateKind, config: Pick<InstanceConfig, "name" | "emails">): string {
  const t = config.emails.templates[kind];
  const name = escapeHtml(config.name);
  const heading = escapeHtml(t.heading);
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${heading}</title>
</head>
<body style="margin:0;padding:24px;background:#f4f4f4;font-family:Arial,Helvetica,sans-serif;color:#111111;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:0;">
<tr><td align="center">
<table role="presentation" width="480" cellspacing="0" cellpadding="0" style="border:0;max-width:480px;width:100%;background:#ffffff;border-radius:8px;">
<tr><td style="padding:24px;font-size:18px;line-height:1.5;">
<p style="margin:0 0 8px;font-size:15px;color:#555555;">${name}</p>
<h1 style="margin:0 0 16px;font-size:24px;line-height:1.3;">${heading}</h1>
<p style="margin:0 0 24px;">${escapeHtml(t.intro)}</p>
<p style="margin:0 0 24px;"><a href="${LINK}" style="display:inline-block;padding:14px 28px;background:#1f4f7a;color:#ffffff;text-decoration:none;font-weight:bold;border-radius:8px;">${escapeHtml(t.button)}</a></p>
<p style="margin:0 0 16px;font-size:16px;">${escapeHtml(config.emails.expires)}</p>
<p style="margin:0 0 16px;font-size:16px;">${escapeHtml(config.emails.fallback)}<br><a href="${LINK}" style="color:#1f4f7a;word-break:break-all;">${LINK}</a></p>
<p style="margin:0;font-size:16px;color:#555555;">${escapeHtml(config.emails.footer)}</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>
`;
}
