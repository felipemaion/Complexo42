"use client";
// Widget do Cloudflare Turnstile (#116) no formulário do link por e-mail. Modo "managed": na
// maioria das vezes não há desafio visível. O widget acrescenta ao formulário o campo
// `cf-turnstile-response`, que a server action confere no servidor (src/server/auth/turnstile.ts).
//
// Sem dependência nova: só o script oficial, com renderização explícita para funcionar também
// quando a tela é montada de novo por navegação no cliente.
import Script from "next/script";
import { useCallback, useEffect, useRef } from "react";

const SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

type Turnstile = {
  render(container: HTMLElement, options: Record<string, unknown>): string | undefined;
  remove(widgetId: string): void;
};

declare global {
  interface Window {
    turnstile?: Turnstile;
  }
}

export function TurnstileWidget({ siteKey }: { siteKey: string }) {
  const container = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | undefined>(undefined);

  const render = useCallback(() => {
    if (!container.current || !window.turnstile || widgetId.current) return;
    widgetId.current = window.turnstile.render(container.current, {
      sitekey: siteKey,
      language: "pt-br",
      size: "flexible",
      theme: "auto",
      "response-field-name": "cf-turnstile-response",
    });
  }, [siteKey]);

  // Script já carregado (volta à tela por navegação no cliente): renderiza já. Ao sair, remove
  // o widget para poder renderizar de novo depois.
  useEffect(() => {
    render();
    return () => {
      if (widgetId.current) window.turnstile?.remove(widgetId.current);
      widgetId.current = undefined;
    };
  }, [render]);

  return (
    <>
      <Script src={SCRIPT_URL} strategy="afterInteractive" onReady={render} />
      <div ref={container} data-turnstile="" className="min-h-[65px]" />
    </>
  );
}
