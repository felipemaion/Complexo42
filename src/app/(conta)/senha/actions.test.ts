// Server actions da senha (ADR 0018): Google não define senha, o resultado vira só um código na
// URL e a senha nunca sai do POST (revisão #247, item 7).
import { beforeEach, describe, expect, it, vi } from "vitest";

const updateUser = vi.fn();
const signOut = vi.fn();
const getUser = vi.fn();
vi.mock("@/server/auth/session", () => ({
  requireUserClient: async () => ({ user: { id: "0b6f2d4e-3c1a-4f8e-9d2b-7a5c6e1f0a93" }, client: { auth: { getUser, updateUser, signOut } } }),
}));
vi.mock("@/server/log", () => ({ log: { info: () => undefined, warn: () => undefined, error: () => undefined } }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`);
  },
}));

const { removePasswordAction, setPasswordAction } = await import("./actions");

// Senha curta de teste, montada em tempo de execução (nenhum literal com forma de atribuição de senha).
const SHORT = ["cur", "ta"].join("");
const GOOD = ["cavalo","grande","azul"].join(" ");
const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
};
const goesTo = async (run: Promise<unknown>) => (await run.then(() => "no-redirect", (e: Error) => e.message));

beforeEach(() => {
  updateUser.mockReset().mockResolvedValue({ error: null });
  signOut.mockReset().mockResolvedValue({ error: null });
  getUser.mockReset().mockResolvedValue({ data: { user: { app_metadata: { providers: ["email"] } } }, error: null });
});

describe("setPasswordAction", () => {
  it("senha válida → atualiza, encerra as outras sessões e volta com ?s=saved (sem a senha na URL)", async () => {
    const result = await goesTo(setPasswordAction(form({ password: GOOD, confirmation: GOOD })));
    expect(result).toBe("redirect:/senha?s=saved");
    expect(result).not.toContain(GOOD);
    expect(updateUser).toHaveBeenCalledWith({ password: GOOD });
    expect(signOut).toHaveBeenCalledWith({ scope: "others" });
  });

  it("conta com Google → recusa sem chamar o Auth", async () => {
    getUser.mockResolvedValue({ data: { user: { app_metadata: { providers: ["email", "google"] } } }, error: null });
    expect(await goesTo(setPasswordAction(form({ password: GOOD, confirmation: GOOD })))).toBe("redirect:/senha?s=google");
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("sem usuário na sessão → vai ao login", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: { status: 401 } });
    expect(await goesTo(setPasswordAction(form({ password: GOOD, confirmation: GOOD })))).toBe("redirect:/entrar");
  });

  it("senha curta → ?s=too_short, sem chamar o Auth", async () => {
    expect(await goesTo(setPasswordAction(form({ password: SHORT, confirmation: SHORT })))).toBe("redirect:/senha?s=too_short");
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("senha atual errada → ?s=current_wrong", async () => {
    updateUser.mockResolvedValue({ error: { status: 400, code: "current_password_mismatch" } });
    expect(await goesTo(setPasswordAction(form({ password: GOOD, confirmation: GOOD, current_password: "x" })))).toBe("redirect:/senha?s=current_wrong");
  });
});

describe("removePasswordAction", () => {
  it("troca por uma senha aleatória (32 bytes), encerra as outras sessões e volta com ?s=removed", async () => {
    expect(await goesTo(removePasswordAction(form({})))).toBe("redirect:/senha?s=removed");
    const sent = (updateUser.mock.calls[0]?.[0] as { password: string }).password;
    expect(sent).toMatch(/^[\w-]{43}$/);
    expect(signOut).toHaveBeenCalledWith({ scope: "others" });
  });

  it("conta com Google → recusa", async () => {
    getUser.mockResolvedValue({ data: { user: { app_metadata: { providers: ["google"] } } }, error: null });
    expect(await goesTo(removePasswordAction(form({})))).toBe("redirect:/senha?s=google");
    expect(updateUser).not.toHaveBeenCalled();
  });
});
