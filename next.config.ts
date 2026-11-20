import type { NextConfig } from "next";

// Cabeçalhos de segurança que não dependem do conteúdo da página (#68). A CSP fica de fora de
// propósito: exige nonce e liberar Turnstile e Supabase, e tem issue própria.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Anti-clickjacking: nenhuma tela do app precisa ser embutida em outro site.
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  // 180 dias, sem includeSubDomains nem preload: reversível se um subdomínio ficar sem HTTPS.
  { key: "Strict-Transport-Security", value: "max-age=15552000" },
  // CSP parcial (#70): só o que pode ser embutido. Lista fechada: o Turnstile do login e a prévia
  // do portfólio pelo YouTube sem cookies (ADR 0007 §5). Scripts, estilos e conexões seguem sem
  // regra aqui: a CSP completa com nonce é a #152.
  {
    key: "Content-Security-Policy",
    value: "frame-src 'self' https://challenges.cloudflare.com https://www.youtube-nocookie.com; object-src 'none'; frame-ancestors 'none'; base-uri 'self'",
  },
] as const;

const nextConfig: NextConfig = {
  // Imagem Docker enxuta, sem node_modules completo (ADR 0009 §3, #80).
  output: "standalone",
  poweredByHeader: false,
  reactStrictMode: true,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders.map((header) => ({ ...header })) }];
  },
  experimental: {
    // Envio da lista de autorizados (#26): arquivo de até 1,5 MB (allowlistLimits.maxBytes)
    // mais o envelope do formulário. Vale para TODAS as server actions, inclusive as sem
    // login: por isso o mínimo que cabe a lista, não mais. O proxy de borda pode limitar o
    // tamanho por rota (docs/OPERACAO.md, #86).
    serverActions: { bodySizeLimit: "2mb" },
  },
};

export default nextConfig;
