import { describe, expect, it } from "vitest";
import { guardAction } from "./guard-action";

// #315: um deploy no meio do fluxo faz o Next recusar a Server Action antiga ("Failed to find Server
// Action"). A promessa rejeita; a tela precisa de um resultado, não de uma exceção.
describe("guardAction", () => {
  it("devolve o resultado da action quando ela responde (ok ou recusa do servidor)", async () => {
    expect(await guardAction(async () => ({ ok: true as const }))).toEqual({ ok: true });
    expect(await guardAction(async () => ({ ok: false as const, error: "failed" as const }))).toEqual({ ok: false, error: "failed" });
  });

  it("action rejeitada (app trocado, rede caída) vira recusa `app_updated`", async () => {
    const result = await guardAction(async () => {
      throw new Error('Failed to find Server Action "abc". This request might be from an older or newer deployment.');
    });
    expect(result).toEqual({ ok: false, error: "app_updated" });
  });

  // Sessão expirada no meio do fluxo: `requireUser*BeforeHouse` chama `redirect()` e o Next rejeita a action no
  // cliente DE PROPÓSITO, para o RedirectBoundary levar ao login. Isso não é "app atualizado".
  it("redirect e not-found do Next propagam: a navegação é do Next, não vira `app_updated`", async () => {
    const redirect = Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;push;/entrar;307;" });
    await expect(guardAction(async () => { throw redirect; })).rejects.toBe(redirect);
    const notFound = Object.assign(new Error("NEXT_HTTP_ERROR_FALLBACK;404"), { digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
    await expect(guardAction(async () => { throw notFound; })).rejects.toBe(notFound);
  });
});
