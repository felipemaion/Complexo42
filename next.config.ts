import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Imagem Docker enxuta, sem node_modules completo (ADR 0009 §3, #80).
  output: "standalone",
  poweredByHeader: false,
  reactStrictMode: true,
};

export default nextConfig;
