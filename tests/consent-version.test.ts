// A versão do termo mora em dois lugares que precisam bater (#11): o texto em config/consent.ts
// e a versão vigente no banco (`app.current_consent_version()`, definida por migration). Versão
// nova = migration nova + texto novo; este teste pega quem mudar só um dos dois.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { consentTerm } from "@config/consent";

const MIGRATIONS = join(__dirname, "..", "supabase", "migrations");
const DEFINITION = /create or replace function app\.current_consent_version\(\)[\s\S]*?select '([^']+)'/i;

/** A versão da definição mais recente (o nome do arquivo começa pela data, então ordena como texto). */
function latestVersionInMigrations(): string | null {
  const files = readdirSync(MIGRATIONS).filter((name) => name.endsWith(".sql")).sort();
  for (const file of files.reverse()) {
    const found = DEFINITION.exec(readFileSync(join(MIGRATIONS, file), "utf8"));
    if (found) return found[1] ?? null;
  }
  return null;
}

describe("versão vigente do termo", () => {
  it("config/consent.ts bate com a migration mais recente de app.current_consent_version()", () => {
    expect(latestVersionInMigrations()).toBe(consentTerm.version);
  });
});
