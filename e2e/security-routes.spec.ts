import { readdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

// #156, parte 2: toda rota de `src/app` que não está na lista pública abaixo, sem sessão, volta para o login (o proxy
// nega por padrão, src/server/auth/routes.ts). A lista de rotas é lida dos arquivos (`page.tsx` e `route.ts`): uma
// rota nova entra no teste sozinha, e só sai do login se alguém a puser na lista pública, que fica aqui, explícita,
// para a revisão ver. Pede só o servidor (sem Supabase).
const APP_DIR = join(process.cwd(), "src/app");

/** Rotas que abrem sem sessão, de propósito. Tudo fora daqui precisa mandar para /entrar. */
const PUBLIC_ROUTES = new Set([
  "/", // página inicial pública
  "/entrar", // o próprio login
  "/espera", // texto fixo da lista de espera (#26)
  "/conta-excluida", // despedida depois de excluir a conta (#18)
  "/auth/confirmar", // página do link de login (o login em si é um POST)
  "/auth/callback", // volta do Google e do link por e-mail
  "/auth/google", // início do login com o Google
  "/auth/sair", // encerra a sessão
  "/api/healthz", // saúde do app, fora do proxy
  "/emails/[template]", // templates do GoTrue, estáticos e sem dado pessoal (#238)
]);

/** Valor de exemplo para segmentos dinâmicos ([id]) ao pedir a rota. */
const SAMPLE = "00000000-0000-0000-0000-000000000000";

function routeFiles(dir: string, prefix = ""): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) {
      // Grupos de rota, "(conta)", não entram no endereço.
      const segment = /^\(.*\)$/.test(entry.name) ? "" : `/${entry.name}`;
      return routeFiles(join(dir, entry.name), prefix + segment);
    }
    return entry.name === "page.tsx" || entry.name === "route.ts" ? [prefix || "/"] : [];
  });
}

const routes = [...new Set(routeFiles(APP_DIR))].sort();
const protectedRoutes = routes.filter((route) => !PUBLIC_ROUTES.has(route));
const urlOf = (route: string) => route.replace(/\[[^\]]+\]/g, SAMPLE);

test("a lista pública só cita rotas que existem (sem entrada esquecida)", () => {
  for (const route of PUBLIC_ROUTES) expect(routes, `rota pública que não existe mais: ${route}`).toContain(route);
});

test("há rotas protegidas a conferir (a leitura dos arquivos funcionou)", () => {
  expect(protectedRoutes.length).toBeGreaterThan(15);
  expect(protectedRoutes).toEqual(expect.arrayContaining(["/inicio", "/perfil", "/meus-dados", "/coordenacao", "/excluir-conta"]));
});

for (const route of protectedRoutes) {
  test(`sem sessão, ${route} manda para o login e não devolve conteúdo`, async ({ request, baseURL }) => {
    const path = urlOf(route);
    for (const method of ["GET", "POST"] as const) {
      const res = await request.fetch(path, { method, maxRedirects: 0, headers: { Origin: baseURL! } });
      expect([302, 303, 307, 308], `${method} ${path} deveria redirecionar`).toContain(res.status());
      const location = new URL(res.headers().location ?? "", baseURL!);
      expect(location.pathname, `${method} ${path}`).toBe("/entrar");
      // Só o caminho vai em `next`: a query de quem não entrou nunca é repassada.
      expect(location.searchParams.get("next"), `${method} ${path}`).toBe(path);
      expect(res.headers()["content-disposition"]).toBeUndefined();
    }
  });
}
