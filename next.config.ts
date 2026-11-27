import type { NextConfig } from "next";

// Cabeçalhos de segurança que não dependem do conteúdo da página (#68). A CSP não fica aqui: ela
// leva um nonce novo a cada requisição e é montada no proxy (src/server/csp.ts, #152).
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Anti-clickjacking: nenhuma tela do app precisa ser embutida em outro site.
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  // 180 dias, sem includeSubDomains nem preload: reversível se um subdomínio ficar sem HTTPS.
  { key: "Strict-Transport-Security", value: "max-age=15552000" },
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
    // CSS em arquivo, não embutido (27/11, medido): embutido, o Next mandava o mesmo CSS duas vezes (no
    // <style> e nos dados do React): página inicial de 22 KB virava 127 KB e o trabalho de estilo/layout no
    // celular subia de ~0,25 s para ~1,1 s. Guarda em tests/no-inline-css.test.ts.
    inlineCss: false,
  },
};

export default nextConfig;
