// Deixa o Node rodar, em scripts de desenvolvimento, o código TypeScript de `src/` sem
// dependência nova (R9): o Node já remove os tipos, mas não completa a extensão `.ts` nos
// imports e não conhece o `server-only`, que o Next embute (ts-resolve-hook.mjs).
// Uso: `node --import ./scripts/ts-resolve.mjs script.mjs`.
import { register } from "node:module";

register("./ts-resolve-hook.mjs", import.meta.url);
