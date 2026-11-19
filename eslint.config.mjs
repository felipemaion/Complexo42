import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// HTML cru no DOM (#17, revisão do #100): texto de terceiros (nomes, redes) só entra como texto.
const rawHtmlMessage = "HTML cru abre XSS: use texto (React escapa) e a lista segura de links do módulo de perfis.";
const rawHtmlProperties = ["innerHTML", "outerHTML", "insertAdjacentHTML"].map((property) => ({
  property,
  message: rawHtmlMessage,
}));

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // HTML cru abre XSS (AGENTS R13/R14; dados de terceiros como redes sociais).
      "react/no-danger": "error",
      "no-restricted-properties": [
        "error",
        ...rawHtmlProperties,
        { object: "document", property: "write", message: rawHtmlMessage },
        { object: "document", property: "writeln", message: rawHtmlMessage },
      ],
      // O que `no-restricted-properties` não pega: `window.document.write` (o objeto não é o
      // identificador `document`) e o `srcDoc` do iframe (HTML inteiro num atributo).
      "no-restricted-syntax": [
        "error",
        {
          selector: "MemberExpression[property.name=/^(write|writeln)$/][object.type='MemberExpression'][object.property.name='document']",
          message: rawHtmlMessage,
        },
        { selector: "JSXAttribute[name.name='srcDoc']", message: rawHtmlMessage },
      ],
      // `any` explícito proibido; o implícito é barrado pelo tsconfig (strict).
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
  globalIgnores([".claude/**", ".next/**", "out/**", "build/**", "coverage/**", "playwright-report/**", "test-results/**", "next-env.d.ts"]),
]);
