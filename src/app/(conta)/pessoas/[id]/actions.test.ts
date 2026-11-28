// "Ver contato" (#48): a action só compõe sessão (R14), validação e `viewMemberContact`; o banco decide, registra e limita.
import { beforeEach, describe, expect, it, vi } from "vitest";

type Outcome = { status: "ok"; contact: Record<string, unknown> } | { status: "forbidden" | "rate_limited" | "failed" };
const viewMemberContact = vi.fn<(client: unknown, target: string, kind: string) => Promise<Outcome>>();
const requireUserClient = vi.fn(async () => ({ user: { id: "u1" }, client: { marker: "jwt-client" } }));

vi.mock("@/modules/profiles", async () => ({
  ...(await vi.importActual<object>("@/modules/profiles/domain/contact")),
  viewMemberContact,
}));
vi.mock("@/server/auth/session", () => ({ requireUserClient }));

const { viewContactAction } = await import("./actions");

const TARGET = "5a4b3c2d-1e0f-4a9b-8c7d-6e5f4a3b2c1d";
const IDLE = { status: "idle" } as const;
const form = (entries: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.set(key, value);
  return data;
};

beforeEach(() => {
  viewMemberContact.mockReset();
});

describe("viewContactAction", () => {
  it("devolve o WhatsApp pronto para a tela, com o link wa.me", async () => {
    viewMemberContact.mockResolvedValue({ status: "ok", contact: { whatsapp: "+5511912345678" } });
    const state = await viewContactAction(IDLE, form({ alvo: TARGET, tipo: "whatsapp" }));
    expect(viewMemberContact).toHaveBeenCalledWith({ marker: "jwt-client" }, TARGET, "whatsapp");
    expect(state).toMatchObject({ status: "ok", kind: "whatsapp", whatsapp: { href: "https://wa.me/5511912345678" } });
  });

  it.each(["forbidden", "rate_limited", "failed"] as const)("repassa %s com o tipo pedido", async (status) => {
    viewMemberContact.mockResolvedValue({ status });
    expect(await viewContactAction(IDLE, form({ alvo: TARGET, tipo: "email" }))).toEqual({ status, kind: "email" });
  });

  it.each<Record<string, string>>([{ alvo: TARGET, tipo: "telefone" }, { alvo: TARGET }, { tipo: "whatsapp" }, {}])(
    "entrada inválida %j dá a mesma resposta de sem permissão e nem chama o banco",
    async (entries) => {
      const state = await viewContactAction(IDLE, form(entries));
      expect(state.status).toBe("forbidden");
      expect(viewMemberContact).not.toHaveBeenCalled();
    },
  );
});
