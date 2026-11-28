// O totem é visto por todo membro logado (ADR 0014, revisão de 28/11; issue #303), mas só o CÓDIGO do totem: as notas dos
// eixos e as respostas seguem internas. O totem fica cifrado no banco (ADR 0003): o servidor o lê pela função
// `member_totems` (só id e valor cifrado, só para membro ativo) e o decifra com a chave do app; o navegador só recebe o
// código validado. As medalhas (/totens/) só carregam com sessão. Estas guardas leem o código-fonte.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { config as proxyConfig } from "@/proxy";
import { decideRoute } from "@/server/auth/routes";

const read = (path: string) => readFileSync(path, "utf8");
const migration = () => {
  const file = readdirSync("supabase/migrations").find((f) => f.endsWith("_member_totems.sql"));
  expect(file, "migration da função member_totems").toBeDefined();
  return read(join("supabase/migrations", file!));
};

describe("o totem é do membro, as notas e as respostas não", () => {
  it("a página da própria pessoa lê o totem pelo leitor do servidor e o entrega ao card", () => {
    const home = read("src/app/(conta)/inicio/page.tsx");
    expect(home).toMatch(/readMemberTotems/);
    expect(home).toMatch(/totem=/);
  });

  it("o leitor só usa a função `member_totems`: nunca a tabela, as notas nem as respostas", () => {
    const reader = read("src/modules/houses/server/member-totems.ts");
    expect(reader).toMatch(/rpc\("member_totems"/);
    expect(reader).not.toMatch(/\.from\(/);
    expect(reader).not.toMatch(/scores_enc|answers_enc|signature|house_key/);
  });

  it("a função do banco devolve só o id e o totem cifrado, só a membro ativo, e não abre a tabela", () => {
    const sql = migration();
    expect(sql).toMatch(/returns table \(profile_id uuid, totem_enc text\)/i);
    expect(sql).toMatch(/app\.is_active_member\(\)/);
    expect(sql).toMatch(/app\.is_active_profile\(/);
    expect(sql).not.toMatch(/scores_enc|answers_enc|signature/);
    expect(sql).not.toMatch(/create policy|alter table|grant select on public\.questionnaire_results/i);
    expect(sql).toMatch(/revoke execute on function public\.member_totems\(uuid\[\]\) from public, anon/i);
  });

  it("os componentes que o navegador renderiza não têm acesso a cifra, ao banco nem à tabela", () => {
    for (const file of ["src/modules/houses/components/own-house-card.tsx", "src/modules/houses/components/totem-medal.tsx"]) {
      const source = read(file);
      expect(source, file).not.toMatch(/@\/server\/crypto|totem_enc|member_totems|\.rpc\(/);
    }
  });

  it("a lista de resultados da coordenação segue sem medalha: o totem lá só aparece ao abrir a pessoa (que registra o acesso)", () => {
    const list = read("src/app/(conta)/coordenacao/casas/resultados/page.tsx");
    expect(list).not.toMatch(/totem-medal|ChosenHouseAndTotem|HouseWithTotem|\.totem\b/);
    expect(read("src/modules/houses/server/coordination-views.ts")).not.toMatch(/readTotems|profile_id,totem_enc/);
    expect(read("src/app/(conta)/coordenacao/casas/resultados/[id]/page.tsx")).toMatch(/ChosenHouseAndTotem/);
  });
});

describe("as medalhas só carregam para quem está logado", () => {
  it("o proxy NÃO exclui /totens/ (diferente de /casas/): sem sessão, vai para /entrar", () => {
    const matcher = proxyConfig.matcher.join("|");
    expect(matcher).not.toContain("totens");
    expect(decideRoute("/totens/pr-128.webp", "", false)).toMatchObject({ action: "redirect" });
    expect(decideRoute("/totens/pr-128.webp", "", true)).toEqual({ action: "next" });
  });
});
