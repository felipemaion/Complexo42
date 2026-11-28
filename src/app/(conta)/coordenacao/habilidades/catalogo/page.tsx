import type { Metadata } from "next";
import Link from "next/link";
import { instance } from "@config/instance";
import { requireCoordinationScreen } from "@/modules/houses";
import { type AdminSkillView, listAdminCatalog, skillErrorText, skillNameLimits } from "@/modules/skills";
import { catalogAction } from "./actions";
import { buttonClass, cardClass, fieldClass, noticeClass, PageShell, textLinkClass } from "@/modules/ui";

export const metadata: Metadata = { title: instance.skills.catalog.title };

const field = fieldClass();
const button = buttonClass("secondary");
const LIST_ID = "grupos-existentes";

// Gestão do catálogo (#25): só a coordenação nacional (os outros recebem 404). Criar, renomear, mover de grupo,
// desativar e mesclar; renomear um grupo é uma operação à parte. Cada mudança fica registrada no banco.
export default async function SkillCatalogPage({
  searchParams,
}: Readonly<{ searchParams: Promise<{ erro?: string; feito?: string }> }>) {
  const { client } = await requireCoordinationScreen("skills");
  const query = await searchParams;
  const skills = await listAdminCatalog(client);
  const text = instance.skills;
  const c = text.catalog;
  const errorText = skillErrorText(text.errors, query.erro);
  const groups = new Map<string, AdminSkillView[]>();
  for (const skill of skills) groups.set(skill.category, [...(groups.get(skill.category) ?? []), skill]);
  const active = skills.filter((skill) => skill.active);
  return (
    <PageShell width="wide">
      <h1 className="text-3xl font-bold sm:text-4xl">{c.title}</h1>
      <p className="max-w-prose text-lg text-ink-muted">{c.intro}</p>
      {query.feito === "1" && (
        <p role="status" className={noticeClass("success")}>
          {c.done}
        </p>
      )}
      {errorText && (
        <p role="alert" className={noticeClass("error")}>
          {errorText}
        </p>
      )}
      <datalist id={LIST_ID}>
        {[...groups.keys()].map((group) => (
          <option key={group} value={group} />
        ))}
      </datalist>
      <section className={cardClass()}>
        <h2 className="text-xl font-semibold">{c.createTitle}</h2>
        <form action={catalogAction} className="flex flex-col gap-3">
          <input type="hidden" name="acao" value="criar" />
          <label className="flex flex-col gap-1 text-lg">
            {c.nameLabel}
            <input name="nome" type="text" required maxLength={skillNameLimits.max} autoComplete="off" className={field} />
          </label>
          <label className="flex flex-col gap-1 text-lg">
            {c.groupLabel}
            <input name="grupo" type="text" required list={LIST_ID} maxLength={skillNameLimits.max} autoComplete="off" className={field} />
          </label>
          <p className="text-ink-muted">{c.groupHint}</p>
          <button type="submit" className={button}>
            {c.createButton}
          </button>
        </form>
      </section>
      {[...groups.entries()].map(([group, items]) => (
        <section key={group} className={cardClass()} data-testid="catalog-group">
          <h2 className="text-xl font-semibold">{group}</h2>
          <form action={catalogAction} className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <input type="hidden" name="acao" value="renomear-grupo" />
            <input type="hidden" name="grupo" value={group} />
            <label className="flex flex-1 flex-col gap-1">
              {c.renameGroupLabel}
              <input name="novo" type="text" required list={LIST_ID} maxLength={skillNameLimits.max} autoComplete="off" className={field} />
            </label>
            <button type="submit" className={button}>
              {c.renameGroupButton}
            </button>
          </form>
          <ul className="flex flex-col gap-4">
            {items.map((skill) => (
              <li key={skill.id} className="flex flex-col gap-2 border-t border-line pt-3" data-testid="catalog-skill" data-name={skill.name}>
                <p className="text-lg font-semibold">
                  {skill.name}
                  {!skill.active && <span className="ml-2 font-normal text-ink-muted">({c.inactive})</span>}
                </p>
                <form action={catalogAction} className="flex flex-col gap-2 sm:flex-row sm:items-end">
                  <input type="hidden" name="habilidade" value={skill.id} />
                  <label className="flex flex-1 flex-col gap-1">
                    {c.nameLabel}
                    <input name="nome" type="text" required defaultValue={skill.name} maxLength={skillNameLimits.max} autoComplete="off" className={field} />
                  </label>
                  <button type="submit" name="acao" value="renomear" className={button}>
                    {c.renameButton}
                  </button>
                </form>
                <form action={catalogAction} className="flex flex-col gap-2 sm:flex-row sm:items-end">
                  <input type="hidden" name="habilidade" value={skill.id} />
                  <label className="flex flex-1 flex-col gap-1">
                    {c.groupLabel}
                    <input name="grupo" type="text" required list={LIST_ID} defaultValue={skill.category} maxLength={skillNameLimits.max} autoComplete="off" className={field} />
                  </label>
                  <button type="submit" name="acao" value="mover" className={button}>
                    {c.moveButton}
                  </button>
                </form>
                <form action={catalogAction} className="flex flex-col gap-2 sm:flex-row sm:items-end">
                  <input type="hidden" name="habilidade" value={skill.id} />
                  <label className="flex flex-1 flex-col gap-1">
                    {c.mergeLabel}
                    <select name="destino" required defaultValue="" className={field}>
                      <option value="" disabled>
                        {c.mergeChoose}
                      </option>
                      {active
                        .filter((other) => other.id !== skill.id)
                        .map((other) => (
                          <option key={other.id} value={other.id}>
                            {other.name}
                          </option>
                        ))}
                    </select>
                  </label>
                  <button type="submit" name="acao" value="mesclar" className={button}>
                    {c.mergeButton}
                  </button>
                </form>
                <form action={catalogAction}>
                  <input type="hidden" name="habilidade" value={skill.id} />
                  <button type="submit" name="acao" value={skill.active ? "desativar" : "reativar"} className={button}>
                    {skill.active ? c.deactivateButton : c.reactivateButton}
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <Link href="/coordenacao/habilidades" className={`${textLinkClass()} self-center`}>
        {c.queueLink}
      </Link>
      <Link href="/coordenacao" className={`${textLinkClass()} self-center`}>
        {text.queue.backLink}
      </Link>
    </PageShell>
  );
}
