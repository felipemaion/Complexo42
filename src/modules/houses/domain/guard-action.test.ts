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
});
