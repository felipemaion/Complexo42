// Excluir a conta sem o aceite do termo (#11): a página e as ações usam só a sessão
// (requireSessionClient), nunca o portão do termo (requireUser/requireUserClient).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("/excluir-conta", () => {
  it.each(["page.tsx", "actions.ts"])("%s não passa pelo portão do termo", (file) => {
    const source = readFileSync(join(__dirname, file), "utf8");
    expect(source).toContain("requireSessionClient");
    expect(source).not.toMatch(/requireUser(Client)?\b/);
  });
});
