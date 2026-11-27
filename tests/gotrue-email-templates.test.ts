import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { instance } from "@config/instance";
import { emailTemplateKinds } from "@/server/auth/email-templates";

// O GoTrue CAI EM SILÊNCIO no template padrão (em inglês) se a URL do template não responde, e nenhum teste de
// app pega isso. Esta trava confere o compose: as cinco variáveis de template e de assunto existem (ancoradas, não
// comentadas), os caminhos são rotas que o app serve e os assuntos são os da config.
const compose = readFileSync("deploy/docker-compose.supabase.yml", "utf8");
const gotrueKey: Record<(typeof emailTemplateKinds)[number], string> = {
  "magic-link": "MAGIC_LINK",
  confirmation: "CONFIRMATION",
  recovery: "RECOVERY",
  invite: "INVITE",
  "email-change": "EMAIL_CHANGE",
};
const valueOf = (key: string): string | undefined => compose.match(new RegExp(`^[ \\t]*${key}:[ \\t]*(.+?)[ \\t]*$`, "m"))?.[1];
const unquote = (value: string) => value.replace(/^"(.*)"$/, "$1");

describe("compose do Supabase: templates e assuntos de e-mail em português", () => {
  it("define os cinco GOTRUE_MAILER_TEMPLATES_* e os cinco GOTRUE_MAILER_SUBJECTS_*, ancorados e sem comentário", () => {
    for (const kind of emailTemplateKinds) {
      expect(valueOf(`GOTRUE_MAILER_TEMPLATES_${gotrueKey[kind]}`), `template ${kind}`).toBeTruthy();
      expect(valueOf(`GOTRUE_MAILER_SUBJECTS_${gotrueKey[kind]}`), `assunto ${kind}`).toBeTruthy();
    }
  });

  it("cada template aponta para a rota do app pela rede interna (${APP_INTERNAL_URL}/emails/<nome>)", () => {
    for (const kind of emailTemplateKinds) {
      const value = valueOf(`GOTRUE_MAILER_TEMPLATES_${gotrueKey[kind]}`)!;
      expect(unquote(value), kind).toMatch(new RegExp(`^\\$\\{APP_INTERNAL_URL:-http://app:3000\\}/emails/${kind}$`));
    }
  });

  it("os assuntos do compose são exatamente os da config (o smoke compara o assunto recebido com este)", () => {
    for (const kind of emailTemplateKinds) {
      expect(unquote(valueOf(`GOTRUE_MAILER_SUBJECTS_${gotrueKey[kind]}`)!), kind).toBe(instance.emails.templates[kind].subject);
    }
  });

  it("nenhum host, domínio ou IP real no compose (só o alias interno e variáveis)", () => {
    const values = emailTemplateKinds.map((kind) => valueOf(`GOTRUE_MAILER_TEMPLATES_${gotrueKey[kind]}`) ?? "");
    for (const value of values) expect(value).not.toMatch(/https?:\/\/(?!app:3000)[a-z0-9.-]+\.[a-z]{2,}|\b\d{1,3}(\.\d{1,3}){3}\b/i);
  });
});
