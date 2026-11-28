// CSP com nonce por requisição (#152). O proxy gera um nonce novo a cada página e o Next o lê do
// cabeçalho da requisição (Content-Security-Policy ou o Report-Only) para marcar os próprios scripts e
// os do next/script. 'strict-dynamic' deixa esses scripts carregarem os que eles mesmos criam.
// Doc oficial: https://nextjs.org/docs/app/guides/content-security-policy
export const CSP_HEADER = "Content-Security-Policy";
export const CSP_REPORT_ONLY_HEADER = "Content-Security-Policy-Report-Only";
export const NONCE_HEADER = "x-nonce";

// Turnstile (#116): script e iframe da Cloudflare, os dois únicos de fora que o app usa
// (https://developers.cloudflare.com/turnstile/reference/content-security-policy/). Liberado em toda
// página, não só em /entrar: redirect de server action (excluir conta, trocar senha, sessão vencida)
// chega a /entrar por navegação no cliente, e aí vale a CSP da página onde a pessoa estava.
const TURNSTILE_ORIGIN = "https://challenges.cloudflare.com";

// Mesmo formato que o Next aceita ao ler o nonce: nada de aspas, espaço ou ';' que abra outra diretiva.
const NONCE_FORMAT = /^[A-Za-z0-9+/_-]+={0,2}$/;

export type CspOptions = {
  readonly nonce: string;
  readonly isDev: boolean;
  readonly isHttps: boolean;
};

export function newNonce(): string {
  return btoa(crypto.randomUUID());
}

/** Com CSP_REPORT_ONLY=1 o navegador só avisa no console: para conferir no staging antes de bloquear. */
export function cspHeaderName(reportOnly: boolean): string {
  return reportOnly ? CSP_REPORT_ONLY_HEADER : CSP_HEADER;
}

export function buildCsp({ nonce, isDev, isHttps }: CspOptions): string {
  if (!NONCE_FORMAT.test(nonce)) throw new Error("csp_nonce_invalid");
  const scripts = [
    "'self'",
    `'nonce-${nonce}'`,
    "'strict-dynamic'",
    TURNSTILE_ORIGIN,
    // O React usa eval só em desenvolvimento, para mensagens de erro melhores.
    isDev ? "'unsafe-eval'" : "",
  ];
  const directives = [
    "default-src 'self'",
    `script-src ${scripts.filter(Boolean).join(" ")}`,
    // Estilos: o Next e o React põem style="" nos elementos; nonce não cobre atributo de estilo.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    // O navegador nunca fala direto com o Supabase: tudo passa pelo servidor do app.
    "connect-src 'self'",
    `frame-src ${TURNSTILE_ORIGIN}`,
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    // Sem form-action: o login com Google responde com redirecionamento para fora, que ele bloquearia.
    // Em http local, upgrade-insecure-requests mandaria os recursos para https e quebraria a página.
    isHttps ? "upgrade-insecure-requests" : "",
  ];
  return directives.filter(Boolean).join("; ");
}
