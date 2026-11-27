import { describe, expect, it } from "vitest";
import { instance } from "@config/instance";
import { emailTemplateKinds } from "@/server/auth/email-templates";
import { GET } from "./route";

const call = (template: string) => GET(new Request(`http://localhost/emails/${template}`), { params: Promise.resolve({ template }) });

describe("GET /emails/<template> (o GoTrue busca pela rede interna, sem sessão)", () => {
  it("cada template responde 200, text/html, com o conteúdo esperado e cache curto", async () => {
    for (const kind of emailTemplateKinds) {
      const response = await call(kind);
      expect(response.status, kind).toBe(200);
      expect(response.headers.get("content-type"), kind).toMatch(/^text\/html/);
      expect(response.headers.get("cache-control"), kind).toMatch(/max-age=\d+/);
      const body = await response.text();
      expect(body, kind).toContain("{{ .ConfirmationURL }}");
      expect(body, kind).toContain(instance.name);
      expect(body, kind).toContain(instance.emails.templates[kind].heading);
    }
  });

  it("template desconhecido: 404 simples, sem eco do nome pedido", async () => {
    const response = await call("<script>alert(1)</script>");
    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain("script");
  });
});
