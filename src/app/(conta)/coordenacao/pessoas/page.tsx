import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { instance } from "@config/instance";
import { COORDINATION_PATH, readCoordinationMenu } from "@/modules/access";
import { sessionHouseClient } from "@/modules/houses";
import { listSearchSkills, maxSearchSkills, parseSearchParams, searchPeople, searchQueryString, SkillSearchPicker } from "@/modules/skills";
import { requireUserClient } from "@/server/auth/session";
import { decryptField } from "@/server/crypto";

export const metadata: Metadata = { title: instance.skills.search.title };

const field = "min-h-12 w-full rounded-xl border-2 border-field bg-transparent px-3 text-lg";
const button = "block w-full rounded-xl border-2 border-current px-6 py-5 text-center text-xl font-semibold focus:outline-none focus-visible:ring-4 focus-visible:ring-offset-2";

// Busca de pessoas por habilidade (#23): o gestor, principalmente o nacional, acha quem tem as habilidades (todas ou
// qualquer uma), por UF e equipe, só dentro do escopo dele (o banco decide). Filtros na URL. A lista mostra nome, equipe,
// município e as habilidades (as buscadas em destaque); nunca contato (#48). Quem não é gestor recebe 404.
export default async function PeopleSearchPage({ searchParams }: Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>) {
  const { user, client: authClient } = await requireUserClient();
  const menu = await readCoordinationMenu(authClient, user.id);
  if (!menu.waitlist) notFound();
  const client = await sessionHouseClient();
  if (!client) notFound();
  const text = instance.skills.search;
  const filters = parseSearchParams(await searchParams);
  const catalog = await listSearchSkills(client);
  const skillName = new Map(catalog.map((skill) => [skill.id, skill.name]));
  const result =
    filters.skillIds.length > 0
      ? await searchPeople(
          client,
          {
            skillIds: filters.skillIds,
            mode: filters.mode,
            ...(filters.state && { state: filters.state }),
            ...(filters.municipality !== undefined && { municipality: filters.municipality }),
            ...(filters.unit && { unit: filters.unit }),
            ...(filters.noTeam && { noTeam: true }),
            ...(filters.after && { after: filters.after }),
          },
          decryptField,
        )
      : null;
  const { after, ...kept } = filters;
  void after;
  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 p-6 pt-10">
      <h1 className="text-3xl font-bold">{text.title}</h1>
      <p className="text-lg">{text.intro}</p>
      <form method="get" className="flex flex-col gap-4">
        <SkillSearchPicker skills={catalog} selected={filters.skillIds} max={maxSearchSkills} text={{ skillLabel: text.skillLabel, removeSkill: text.removeSkill }} />
        <fieldset className="flex flex-col gap-2">
          <legend className="text-lg font-semibold">{text.modeLabel}</legend>
          <label className="flex min-h-12 items-center gap-3 text-lg">
            <input type="radio" name="modo" value="todas" defaultChecked={filters.mode === "all"} className="h-6 w-6" />
            {text.modeAll}
          </label>
          <label className="flex min-h-12 items-center gap-3 text-lg">
            <input type="radio" name="modo" value="qualquer" defaultChecked={filters.mode === "any"} className="h-6 w-6" />
            {text.modeAny}
          </label>
        </fieldset>
        <label className="flex flex-col gap-1 text-lg font-semibold">
          {text.stateLabel}
          <input name="uf" type="text" maxLength={2} defaultValue={filters.state ?? ""} autoComplete="off" className={field} />
        </label>
        <label className="flex min-h-12 items-center gap-3 text-lg">
          <input type="checkbox" name="sem" value="1" defaultChecked={filters.noTeam === true} className="h-6 w-6" />
          {text.noTeamLabel}
        </label>
        <button type="submit" className={button}>
          {text.submitButton}
        </button>
      </form>
      {result === null && <p className="text-lg">{text.choose}</p>}
      {result && !result.ok && (
        <p role="alert" className="rounded-xl border-2 border-danger p-4 text-lg">
          {text.errors[result.error]}
        </p>
      )}
      {result?.ok && result.people.length === 0 && <p className="text-lg">{text.noResults}</p>}
      {result?.ok && result.people.length > 0 && (
        <>
          <ul className="flex flex-col gap-3">
            {result.people.map((person) => (
              <li key={person.id} className="flex flex-col gap-2 rounded-xl border-2 border-current p-4" data-testid="person-result" data-person-id={person.id}>
                <p className="text-xl font-semibold">{person.name ?? text.unreadableName}</p>
                <p className="text-lg">
                  {[person.municipality, person.state].filter(Boolean).join(" / ")} · {text.teamLabel}: {person.team ?? text.noTeam}
                </p>
                <p className="text-lg">
                  {person.skillIds.map((id, index) => (
                    <span key={id}>
                      {index > 0 && ", "}
                      {filters.skillIds.includes(id) ? <strong>{skillName.get(id) ?? id}</strong> : (skillName.get(id) ?? id)}
                    </span>
                  ))}
                </p>
                <p className="text-base">{text.inCommon.replace("{count}", String(person.commonCount))}</p>
              </li>
            ))}
          </ul>
          {result.next && (
            <Link href={`/coordenacao/pessoas?${searchQueryString(kept, result.next)}`} className={button}>
              {text.more}
            </Link>
          )}
        </>
      )}
      <Link href={COORDINATION_PATH} className="text-center text-lg underline">
        {text.backLink}
      </Link>
    </main>
  );
}
