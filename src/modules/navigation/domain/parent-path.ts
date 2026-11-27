// Navegação de volta das páginas logadas (#205): cada página tem uma página-mãe lógica, e a
// regra é pura para valer também em quem abre a página por link direto (sem histórico).

/** Página inicial de quem está logado e liberado (a raiz da árvore). */
const HOME = "/inicio";

/** Páginas que existem dentro de `(conta)`, cada uma com a mãe. `/coordenacao/casas` não é página. */
const PARENT_OF: Readonly<Record<string, string>> = {
  "/casa": HOME,
  "/perfil": HOME,
  "/perfil/contato": "/perfil",
  "/coordenacao": HOME,
  "/coordenacao/autorizados": "/coordenacao",
  "/coordenacao/bloqueio": "/coordenacao",
  "/coordenacao/espera": "/coordenacao",
  "/coordenacao/casas/analise": "/coordenacao",
  "/coordenacao/casas/delegacoes": "/coordenacao",
  "/coordenacao/casas/resultados": "/coordenacao",
};

function normalize(pathname: string): string {
  const path = pathname.split(/[?#]/)[0]?.replace(/\/+$/, "") ?? "";
  return path === "" ? "/" : path;
}

/**
 * Página-mãe de `pathname`, ou `null` na página inicial. Página conhecida usa a tabela; segmento
 * dinâmico (`/coordenacao/casas/resultados/<id>`) ou página nova ainda não cadastrada sobe um
 * segmento por vez até achar uma página conhecida. Fora disso, o início.
 */
export function parentPath(pathname: string): string | null {
  const path = normalize(pathname);
  if (path === HOME) return null;
  let current = path;
  while (current !== "/") {
    const parent = PARENT_OF[current];
    if (parent !== undefined) return parent;
    current = current.slice(0, current.lastIndexOf("/")) || "/";
    if (current in PARENT_OF) return current;
  }
  return HOME;
}
