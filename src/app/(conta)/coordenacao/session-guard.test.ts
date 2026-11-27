// As actions da coordenação (#26) só falam com o banco pelo cliente da sessão (JWT de quem está
// logado, R14). Sem sessão, o `requireUserClient` de verdade redireciona para o login antes de
// qualquer cliente ser criado; e nenhum cliente admin ou com service_role existe nesse caminho.
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

const created: string[] = [];

vi.mock("next/headers", () => ({
  cookies: async () => ({ getAll: () => [], set: () => {}, delete: () => {} }),
  headers: async () => new Headers(),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`);
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
// Qualquer cliente do Supabase criado neste caminho fica registrado (e nenhum deveria ser).
vi.mock(import("@supabase/ssr"), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    createServerClient: ((...args: Parameters<typeof actual.createServerClient>) => {
      created.push("ssr");
      return actual.createServerClient(...args);
    }) as typeof actual.createServerClient,
  };
});
vi.mock("@supabase/supabase-js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  createClient: () => {
    created.push("supabase-js");
    throw new Error("cliente direto não é permitido aqui");
  },
}));

const { importAllowlistAction } = await import("./autorizados/actions");
const { decideAccessAction } = await import("./espera/actions");
const { memberBlockAction } = await import("./bloqueio/actions");
const { resolveCaseAction } = await import("./casas/analise/actions");
const { grantDelegationAction, revokeDelegationAction } = await import("./casas/delegacoes/actions");

function uploadForm(): FormData {
  const data = new FormData();
  data.set("arquivo", new File(["pessoa@exemplo.org"], "lista.txt"));
  data.set("origem", "manual");
  return data;
}
function decisionForm(): FormData {
  const data = new FormData();
  data.set("pessoa", "6a1d7c2e-5b4f-4e3a-9c8d-1f2e3a4b5c6d");
  data.set("decisao", "liberar");
  return data;
}

describe("actions da coordenação sem sessão", () => {
  it("enviar a lista: redireciona para o login sem criar cliente nem chamar RPC", async () => {
    await expect(importAllowlistAction({ status: "idle" }, uploadForm())).rejects.toThrow("redirect:/entrar");
    expect(created).toEqual([]);
  });

  it("decidir: redireciona para o login sem criar cliente nem chamar RPC", async () => {
    await expect(decideAccessAction(decisionForm())).rejects.toThrow("redirect:/entrar");
    expect(created).toEqual([]);
  });

  it("bloquear: redireciona para o login sem criar cliente nem chamar RPC", async () => {
    const data = new FormData();
    data.set("email", "pessoa@exemplo.org");
    data.set("acao", "bloquear");
    data.set("etapa", "confirmar");
    await expect(memberBlockAction({ status: "idle" }, data)).rejects.toThrow("redirect:/entrar");
    expect(created).toEqual([]);
  });

  it("resolver caso, conceder e revogar delegação (#174): redirecionam para o login sem criar cliente", async () => {
    const data = new FormData();
    data.set("pedido", "6a1d7c2e-5b4f-4e3a-9c8d-1f2e3a4b5c6d");
    await expect(resolveCaseAction(data)).rejects.toThrow("redirect:/entrar");
    await expect(grantDelegationAction(data)).rejects.toThrow("redirect:/entrar");
    await expect(revokeDelegationAction(data)).rejects.toThrow("redirect:/entrar");
    expect(created).toEqual([]);
  });
});

describe("nenhum cliente admin ou service_role", () => {
  const sources = [
    "src/app/(conta)/coordenacao/autorizados/actions.ts",
    "src/app/(conta)/coordenacao/espera/actions.ts",
    "src/app/(conta)/coordenacao/bloqueio/actions.ts",
    "src/app/(conta)/coordenacao/bloqueio/page.tsx",
    "src/app/(conta)/coordenacao/page.tsx",
    "src/app/(conta)/coordenacao/autorizados/page.tsx",
    "src/app/(conta)/coordenacao/espera/page.tsx",
    "src/modules/access/server/access.ts",
    "src/modules/access/server/coordination.ts",
    "src/app/(conta)/coordenacao/casas/analise/actions.ts",
    "src/app/(conta)/coordenacao/casas/analise/page.tsx",
    "src/app/(conta)/coordenacao/casas/analise/[id]/page.tsx",
    "src/app/(conta)/coordenacao/casas/delegacoes/actions.ts",
    "src/app/(conta)/coordenacao/casas/delegacoes/page.tsx",
    "src/app/(conta)/coordenacao/casas/resultados/page.tsx",
    "src/app/(conta)/coordenacao/casas/resultados/[id]/page.tsx",
    "src/modules/houses/server/coordination-views.ts",
    "src/modules/houses/server/coordination-session.ts",
  ];

  it.each(sources)("%s usa só o cliente da sessão", (path) => {
    const code = readFileSync(path, "utf8");
    expect(code).not.toMatch(/service_role|SERVICE_ROLE|SERVICE_KEY|auth\.admin|@supabase\/supabase-js|createClient\(/);
  });

  it("as actions pegam o cliente de requireUserClient", () => {
    for (const path of sources.filter((p) => p.endsWith("actions.ts"))) {
      expect(readFileSync(path, "utf8")).toContain("await requireUserClient()");
    }
  });
});
