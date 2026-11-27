import { describe, expect, it } from "vitest";
import { instance } from "@config/instance";
import { emailTemplateKinds, isEmailTemplateKind, renderEmailTemplate } from "./email-templates";

describe("templates de e-mail do login (GoTrue)", () => {
  it("são os cinco do GoTrue: link de entrada, confirmação, recuperação, convite e troca de e-mail", () => {
    expect([...emailTemplateKinds]).toEqual(["magic-link", "confirmation", "recovery", "invite", "email-change"]);
    expect(isEmailTemplateKind("magic-link")).toBe(true);
    expect(isEmailTemplateKind("../segredo")).toBe(false);
    expect(isEmailTemplateKind(undefined)).toBe(false);
  });

  it("mantêm as variáveis do GoTrue intactas (o endereço do link aparece no botão e em texto) e levam o nome do app", () => {
    for (const kind of emailTemplateKinds) {
      const html = renderEmailTemplate(kind, instance);
      expect(html, kind).toMatch(/^<!doctype html>/i);
      expect(html, kind).toContain('lang="pt-BR"');
      expect(html.split("{{ .ConfirmationURL }}").length - 1, `${kind}: botão e texto`).toBeGreaterThanOrEqual(2);
      expect(html, kind).toContain(instance.name);
      expect(html, kind).toContain(instance.emails.templates[kind].heading);
    }
    expect(renderEmailTemplate("email-change", instance)).toContain("{{ .NewEmail }}");
  });

  it("são HTML de e-mail simples: sem JavaScript, sem recurso externo, sem marca de terceiros", () => {
    for (const kind of emailTemplateKinds) {
      const html = renderEmailTemplate(kind, instance);
      expect(html, kind).not.toMatch(/<script|javascript:|\\son[a-z]+=|<iframe|<link|<img|@import|url\(/i);
      expect(html, kind).not.toMatch(/https?:\/\//i);
      expect(html, kind).not.toMatch(/supabase|gotrue|google|cloudflare/i);
    }
  });

  it("escapam o nome do app (a config não injeta HTML)", () => {
    const html = renderEmailTemplate("magic-link", { ...instance, name: '<b onclick="x">Nome & Cia</b>' });
    expect(html).toContain("&lt;b onclick=&quot;x&quot;&gt;Nome &amp; Cia&lt;/b&gt;");
    expect(html).not.toContain("<b onclick");
  });

  it("não levam dado pessoal nem segredo: só variáveis do GoTrue e texto fixo da config", () => {
    for (const kind of emailTemplateKinds) {
      const vars = [...renderEmailTemplate(kind, instance).matchAll(/\{\{\s*([^}]+?)\s*\}\}/g)].map((m) => m[1]);
      for (const v of vars) expect([".ConfirmationURL", ".NewEmail"], `${kind}: ${v}`).toContain(v);
    }
  });
});
