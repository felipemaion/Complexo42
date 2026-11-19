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
    // Envio da lista de autorizados (#26): arquivo de até 5 MB (allowlistLimits.maxBytes) mais
    // o envelope do formulário. O padrão de 1 MB cortaria listas grandes; a action confere o
    // limite real antes de ler o arquivo.
    serverActions: { bodySizeLimit: "6mb" },
  },
};

export default nextConfig;
