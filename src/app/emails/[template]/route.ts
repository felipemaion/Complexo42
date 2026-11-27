import { instance } from "@config/instance";
import { isEmailTemplateKind, renderEmailTemplate } from "@/server/auth/email-templates";

// Templates de e-mail do GoTrue (#238): públicos e estáticos, sem sessão e sem dado pessoal; o GoTrue os busca
// pela rede interna (${APP_INTERNAL_URL}/emails/<nome>). O proxy deixa /emails/ fora do login (src/proxy.ts).
// Nome desconhecido: 404 simples, sem repetir o que foi pedido.
export async function GET(_request: Request, context: { params: Promise<{ template: string }> }): Promise<Response> {
  const { template } = await context.params;
  if (!isEmailTemplateKind(template)) return new Response("não encontrado", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  return new Response(renderEmailTemplate(template, instance), {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=300" },
  });
}
