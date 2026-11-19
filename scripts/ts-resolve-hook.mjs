// Hook de resolução registrado por scripts/ts-resolve.mjs.
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const serverOnlyEmpty = pathToFileURL(
  fileURLToPath(new URL("../node_modules/next/dist/compiled/server-only/empty.js", import.meta.url)),
).href;

/** Destino de um import que o Node não resolve sozinho; `null` deixa o Node decidir. */
export function resolveTarget(specifier, parentUrl) {
  if (specifier === "server-only") return serverOnlyEmpty;
  const isRelative = specifier.startsWith("./") || specifier.startsWith("../");
  if (!isRelative || !parentUrl?.startsWith("file:") || /\.[cm]?[jt]sx?$/.test(specifier)) return null;
  for (const suffix of [".ts", "/index.ts"]) {
    const candidate = new URL(specifier + suffix, parentUrl);
    if (existsSync(candidate)) return candidate.href;
  }
  return null;
}

export async function resolve(specifier, context, nextResolve) {
  const url = resolveTarget(specifier, context.parentURL);
  return url ? { url, shortCircuit: true } : nextResolve(specifier, context);
}
