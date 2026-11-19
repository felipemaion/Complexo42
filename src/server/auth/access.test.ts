import { describe, expect, it, vi } from "vitest";
import type { AccessStatus } from "@/modules/profiles";
import { checkAccess } from "./access";

const deps = (status: AccessStatus | null, resolved: AccessStatus | null = null) => ({
  readStatus: vi.fn(async () => status),
  resolve: vi.fn(async () => resolved),
});

describe("checkAccess (#9, M2)", () => {
  it("active segue sem chamar o gancho", async () => {
    const d = deps("active");
    expect(await checkAccess(d)).toBe("allow");
    expect(d.resolve).not.toHaveBeenCalled();
  });

  it("sem perfil chama o gancho (sessão obtida fora do callback também passa por aqui)", async () => {
    const d = deps(null);
    expect(await checkAccess(d)).toBe("allow");
    expect(d.resolve).toHaveBeenCalledOnce();
  });

  it("pending chama o gancho e respeita a decisão de espera", async () => {
    expect(await checkAccess(deps("pending", "waitlisted"))).toBe("waitlist");
    expect(await checkAccess(deps("pending", "active"))).toBe("allow");
  });

  it("waitlisted vai para a espera e blocked é encerrado, sem chamar o gancho", async () => {
    const waiting = deps("waitlisted");
    expect(await checkAccess(waiting)).toBe("waitlist");
    expect(waiting.resolve).not.toHaveBeenCalled();
    expect(await checkAccess(deps("blocked"))).toBe("blocked");
  });

  it("falha na leitura ou no gancho propaga (quem chama encerra a sessão)", async () => {
    await expect(checkAccess({ readStatus: async () => Promise.reject(new Error("db")), resolve: async () => null })).rejects.toThrow();
    await expect(checkAccess({ readStatus: async () => null, resolve: async () => Promise.reject(new Error("email_not_confirmed")) })).rejects.toThrow();
  });
});
