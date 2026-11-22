// Content-Security-Policy completa (#152), montada a cada requisição pelo proxy com um nonce novo.
// Puro: sem Next, sem rede (testado em csp.test.ts).
//
// - Scripts: só os do próprio app com o nonce da requisição ('strict-dynamic': o que eles carregam,
//   como o script do Turnstile pelo next/script, também vale). Nunca 'unsafe-inline' em script.
// - Estilos: 'unsafe-inline' fica, de propósito: o app usa `style` em elementos (cores da instância
//   no <html>, cores da bandeira da equipe), e nonce não vale para atributo de estilo.
// - Turnstile só na tela de entrar; prévia do YouTube sem cookies só no portfólio (#70).
// - O navegador não fala com o Supabase (tudo passa pelo servidor), então ele não é liberado.
// - Sem `form-action`: o login com Google sai de um formulário e passa por redirecionamentos para
//   fora; travar o destino quebraria esse login sem ganho real (os formulários só postam no app).

export const CSP_HEADER = "Content-Security-Policy";
export const CSP_REPORT_ONLY_HEADER = "Content-Security-Policy-Report-Only";
export const NONCE_HEADER = "x-nonce";

const TURNSTILE_ORIGIN = "https://challenges.cloudflare.com";
const YOUTUBE_ORIGIN = "https://www.youtube-nocookie.com";
const LOGIN_PATH = "/entrar";
const PORTFOLIO_PATH = "/perfil/portfolio";

export type CspOptions = {
  readonly nonce: string;
  readonly path: string;
  readonly isDev: boolean;
  readonly isHttps: boolean;
};

/** Nonce novo por requisição (base64 de um UUID aleatório, como na documentação do Next). */
export function newNonce(): string {
  return btoa(crypto.randomUUID());
}

/** O cabeçalho que vale: "Report-Only" só avisa (para testar no staging antes de bloquear). */
export function cspHeaderName(reportOnly: boolean): string {
  return reportOnly ? CSP_REPORT_ONLY_HEADER : CSP_HEADER;
}

export function buildCsp({ nonce, path, isDev, isHttps }: CspOptions): string {
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(nonce)) throw new Error("csp_nonce_invalid");
  const onLogin = path === LOGIN_PATH;
  const onPortfolio = path === PORTFOLIO_PATH;
  const frames = onLogin ? TURNSTILE_ORIGIN : onPortfolio ? YOUTUBE_ORIGIN : "'none'";
  const directives = [
    "default-src 'self'",
    // O host do Turnstile só vale para navegador antigo sem 'strict-dynamic' (os novos o ignoram).
    // 'unsafe-eval' só em desenvolvimento: o React usa eval para depurar.
    ["script-src 'self'", `'nonce-${nonce}'`, "'strict-dynamic'", onLogin ? TURNSTILE_ORIGIN : "", isDev ? "'unsafe-eval'" : ""]
      .filter(Boolean)
      .join(" "),
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    `frame-src ${frames}`,
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    // Só com HTTPS: em http://127.0.0.1 (testes) trocaria os recursos para https e quebraria tudo.
    isHttps ? "upgrade-insecure-requests" : "",
  ];
  return directives.filter(Boolean).join("; ");
}
