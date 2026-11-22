import type { Metadata } from "next";
import { instance } from "@config/instance";
import { readSkillsCatalog, sessionSearchClient } from "@/modules/search";
import { buttonClass, Card, inputClass, labelClass, Notice, PageShell, Tag } from "@/modules/ui";
import { requireUser } from "@/server/auth/session";
import { log } from "@/server/log";
import { saveSkillAction, toggleSkillAction } from "./actions";

export const metadata: Metadata = { title: instance.skillsCatalog.title };

type Props = { readonly searchParams: Promise<{ readonly ok?: string; readonly erro?: string }> };

// Catálogo de habilidades (#25): só o gestor nacional vê a lista (o banco devolve vazio para os
// outros). Criar, editar nome, área e sinônimos, desativar e reativar; nada é apagado.
export default async function SkillsCatalogPage({ searchParams }: Props) {
  await requireUser();
  const text = instance.skillsCatalog;
  const params = await searchParams;
  const client = await sessionSearchClient();
  const skills = client
    ? await readSkillsCatalog(client).catch((error: unknown) => {
        log.warn("catalog_read_failed", { error: error instanceof Error ? error.message : "unknown" });
        return [];
      })
    : [];
  const error = (["invalid", "not_allowed", "duplicate", "failed"] as const).find((key) => key === params.erro);

  if (skills.length === 0) {
    return (
      <PageShell title={text.title} intro={text.intro}>
        <Notice tone="warning">{text.notAllowed}</Notice>
      </PageShell>
    );
  }

  return (
    <PageShell title={text.title} intro={text.intro} width="wide">
      {params.ok === "1" && <Notice tone="success">{text.done}</Notice>}
      {error && <Notice tone="error">{text.errors[error]}</Notice>}
      <div className="grid gap-8 lg:grid-cols-12">
        <ul className="flex flex-col gap-3 lg:col-span-8">
          {skills.map((skill) => (
            <li key={skill.id} className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4">
              <form action={saveSkillAction} className="grid gap-3 md:grid-cols-3 md:items-end">
                <input type="hidden" name="skillId" value={skill.id} />
                <label className="flex flex-col gap-1">
                  <span className={labelClass}>{text.nameLabel}</span>
                  <input name="name" required minLength={2} maxLength={80} defaultValue={skill.name} className={inputClass} />
                </label>
                <label className="flex flex-col gap-1">
                  <span className={labelClass}>{text.categoryLabel}</span>
                  <input name="category" required minLength={2} maxLength={80} defaultValue={skill.category} className={inputClass} />
                </label>
                <label className="flex flex-col gap-1">
                  <span className={labelClass}>{text.aliasesLabel}</span>
                  <input name="aliases" maxLength={1000} defaultValue={skill.aliases.join(", ")} className={inputClass} />
                </label>
                <button type="submit" className={`${buttonClass("secondary", { isFullWidth: false })} md:col-span-3 md:justify-self-start`}>
                  {text.saveButton}
                </button>
              </form>
              <form action={toggleSkillAction} className="flex items-center gap-3">
                <input type="hidden" name="skillId" value={skill.id} />
                <input type="hidden" name="active" value={skill.active ? "false" : "true"} />
                <Tag tone={skill.active ? "success" : "neutral"}>{skill.active ? text.activeTag : text.inactiveTag}</Tag>
                <button type="submit" className={buttonClass(skill.active ? "danger" : "quiet", { isFullWidth: false })}>
                  {skill.active ? text.deactivateButton : text.activateButton}
                </button>
              </form>
            </li>
          ))}
        </ul>
        <div className="lg:col-span-4">
          <Card title={text.addTitle}>
            <form action={saveSkillAction} className="flex flex-col gap-4">
              <input type="hidden" name="skillId" value="" />
              <label className="flex flex-col gap-1">
                <span className={labelClass}>{text.nameLabel}</span>
                <input name="name" required minLength={2} maxLength={80} className={inputClass} />
              </label>
              <label className="flex flex-col gap-1">
                <span className={labelClass}>{text.categoryLabel}</span>
                <input name="category" required minLength={2} maxLength={80} className={inputClass} />
              </label>
              <label className="flex flex-col gap-1">
                <span className={labelClass}>{text.aliasesLabel}</span>
                <input name="aliases" maxLength={1000} className={inputClass} />
              </label>
              <button type="submit" className={buttonClass("primary")}>
                {text.addButton}
              </button>
            </form>
          </Card>
        </div>
      </div>
    </PageShell>
  );
}
