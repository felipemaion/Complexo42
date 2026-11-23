import { readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { expect, test } from "@playwright/test";

// Rotas protegidas (#156, parte 2): o teste lê TODA página (page.tsx) e rota (route.ts) de src/app
// e confere que, sem sessão, cada uma fora da lista pública manda para o login com o `next` certo.
// Rota nova entra aqui sozinha; uma rota pública nova precisa entrar na lista abaixo de propósito
// (e em src/server/auth/routes.ts). Não precisa de Supabase: sem ele, ninguém está logado.

/** Rotas abertas sem sessão (espelho de PUBLIC_PATHS em src/server/auth/routes.ts e do matcher do proxy).
 *  /favicon.ico (22/11): ícone da aba gerado da configuração; o matcher do proxy já o deixava passar,
 *  porque o navegador pede o ícone antes de qualquer login. Não tem dado de ninguém. */
const PUBLIC = new Set(["/", "/entrar", "/auth/callback", "/auth/confirmar", "/auth/sair", "/espera", "/conta-excluida", "/demo", "/api/healthz", "/favicon.ico"]);
/** Rotas que só aceitam POST: conferidas com POST (o GET nem existe). */
const POST_ONLY = new Set(["/meus-dados"]);
const SAMPLE_ID = "00000000-0000-4000-8000-000000000000";

function collectRoutes(dir: string, root: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return collectRoutes(full, root);
    if (entry.name !== "page.tsx" && entry.name !== "route.ts") return [];
    const segments = relative(root, dir)
      .split(sep)
      .filter((s) => s !== "" && !/^\(.*\)$/.test(s)) // grupos como (conta) não entram na URL
      .map((s) => (/^\[.*\]$/.test(s) ? SAMPLE_ID : s));
    return [`/${segments.join("/")}`];
  });
}

const appDir = join(process.cwd(), "src", "app");
const routes = [...new Set(collectRoutes(appDir, appDir))].sort();
const protectedRoutes = routes.filter((path) => !PUBLIC.has(path));

test("a lista de rotas foi lida e a lista pública só tem rotas que existem", () => {
  expect(protectedRoutes.length).toBeGreaterThan(20);
  for (const path of PUBLIC) expect(routes, `rota pública que não existe: ${path}`).toContain(path);
});

for (const path of protectedRoutes) {
  test(`sem sessão, ${path} manda para o login`, async ({ page, request, baseURL }) => {
    const login = `${baseURL}/entrar?next=${encodeURIComponent(path)}`;
    if (POST_ONLY.has(path)) {
      const res = await request.post(path, { maxRedirects: 0 });
      expect(res.status()).toBeGreaterThanOrEqual(300);
      expect(res.status()).toBeLessThan(400);
      expect(new URL(res.headers().location ?? "", baseURL).href).toBe(login);
      return;
    }
    await page.goto(path);
    await expect(page).toHaveURL(login);
  });
}
