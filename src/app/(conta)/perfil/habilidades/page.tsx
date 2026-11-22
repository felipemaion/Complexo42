import type { Metadata } from "next";
import { instance } from "@config/instance";
import { MAX_MY_SKILLS, readMySkillIds, readSelectableSkills, sessionSearchClient, SkillPicker } from "@/modules/search";
import { buttonClass, Notice, PageShell } from "@/modules/ui";
import { requireUser } from "@/server/auth/session";
import { log } from "@/server/log";
import { saveMySkillsAction } from "./actions";

export const metadata: Metadata = { title: instance.mySkills.title };

type Props = { readonly searchParams: Promise<{ readonly ok?: string; readonly erro?: string }> };

const failed = (event: string) => (error: unknown) => {
  log.warn(event, { error: error instanceof Error ? error.message : "unknown" });
  return null;
};

// Minhas habilidades (#15): a pessoa marca do catálogo (só ativas, até 12). A busca da coordenação
// (#23) acha quem marcou; o contato não aparece lá.
export default async function MySkillsPage({ searchParams }: Props) {
  await requireUser();
  const text = instance.mySkills;
  const params = await searchParams;
  const client = await sessionSearchClient();
  const [skills, mine] = client
    ? await Promise.all([
        readSelectableSkills(client).catch(failed("skills_read_failed")),
        readMySkillIds(client).catch(failed("my_skills_read_failed")),
      ])
    : [null, null];
  const error = (["invalid", "too_many", "not_allowed", "failed"] as const).find((key) => key === params.erro);
  // Falha na leitura não pode parecer "nada marcado": sem as duas listas, a página não oferece salvar.
  const canEdit = skills !== null && mine !== null;

  return (
    <PageShell title={text.title} intro={text.intro} width="wide">
      {params.ok === "1" && <Notice tone="success">{text.done}</Notice>}
      {error && <Notice tone="error">{text.errors[error]}</Notice>}
      {canEdit ? (
        <form action={saveMySkillsAction} className="flex flex-col gap-8">
          <SkillPicker
            skills={skills}
            // Só as marcadas que aparecem na tela (as desativadas ficam guardadas e não contam no limite).
            selected={mine.filter((id) => skills.some((skill) => skill.id === id))}
            max={MAX_MY_SKILLS}
            text={{ searchLabel: text.searchLabel, counter: text.counter, limitReached: text.limitReached, noMatch: text.noMatch }}
          />
          <button type="submit" className={`${buttonClass("primary", { isFullWidth: false })} sm:self-start`}>
            {text.saveButton}
          </button>
        </form>
      ) : (
        <Notice tone="error">{text.errors.failed}</Notice>
      )}
    </PageShell>
  );
}
