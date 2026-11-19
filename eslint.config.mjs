import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // HTML cru abre XSS (AGENTS R13/R14; dados de terceiros como redes sociais).
      "react/no-danger": "error",
      // `any` explícito proibido; o implícito é barrado pelo tsconfig (strict).
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
  globalIgnores([".claude/**", ".next/**", "out/**", "build/**", "coverage/**", "playwright-report/**", "test-results/**", "next-env.d.ts"]),
]);
