import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { instance } from "@config/instance";
import { COORDINATION_PATH, readCoordinationMenu } from "@/modules/access";
import { sessionHouseClient } from "@/modules/houses";
import { listMunicipalities, listSearchSkills, listTeams, maxSearchSkills, parseSearchParams, searchPeople, searchQueryString, SkillSearchPicker } from "@/modules/skills";
import { requireUserClient } from "@/server/auth/session";
import { decryptField } from "@/server/crypto";
import { buttonClass, cardClass, fieldClass, noticeClass, PageShell, textLinkClass } from "@/modules/ui";

export const metadata: Metadata = { title: instance.skills.search.title };

const field = fieldClass();
const button = buttonClass("secondary", "lg");

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
  const [catalog, teams, municipalities] = await Promise.all([listSearchSkills(client), listTeams(client), filters.state ? listMunicipalities(client, filters.state) : Promise.resolve([])]);
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
    <PageShell width="wide">
      <h1 className="text-3xl font-bold sm:text-4xl">{text.title}</h1>
      <p className="max-w-prose text-lg text-ink-muted">{text.intro}</p>
      <form method="get" className={cardClass()}>
        <SkillSearchPicker skills={catalog} selected={filters.skillIds} max={maxSearchSkills} text={{ skillLabel: text.skillLabel, removeSkill: text.removeSkill }} />
        <fieldset className="flex flex-col gap-2">
          <legend className="text-lg font-semibold">{text.modeLabel}</legend>
          <label className="flex min-h-12 items-center gap-3 text-lg">
            <input type="radio" name="modo" value="todas" defaultChecked={filters.mode === "all"} className="size-6 accent-primary" />
            {text.modeAll}
          </label>
          <label className="flex min-h-12 items-center gap-3 text-lg">
            <input type="radio" name="modo" value="qualquer" defaultChecked={filters.mode === "any"} className="size-6 accent-primary" />
            {text.modeAny}
          </label>
        </fieldset>
        <label className="flex flex-col gap-1 text-lg font-semibold">
          {text.stateLabel}
          <input name="uf" type="text" maxLength={2} defaultValue={filters.state ?? ""} autoComplete="off" className={field} />
        </label>
        {filters.state ? (
          <label className="flex flex-col gap-1 text-lg font-semibold">
            {text.municipalityLabel}
            <select name="mun" defaultValue={filters.municipality === undefined ? "" : String(filters.municipality)} className={field}>
              <option value="">{text.municipalityAny}</option>
              {municipalities.map((m) => (
                <option key={m.code} value={m.code}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <p className="text-base text-ink-muted">{text.municipalityHint}</p>
        )}
        <label className="flex flex-col gap-1 text-lg font-semibold">
          {text.teamFilterLabel}
          <select name="equipe" defaultValue={filters.unit ?? ""} className={field}>
            <option value="">{text.teamAny}</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-h-12 items-center gap-3 text-lg">
          <input type="checkbox" name="sem" value="1" defaultChecked={filters.noTeam === true} className="size-6 accent-primary" />
          {text.noTeamLabel}
        </label>
        <button type="submit" className={buttonClass("primary", "lg")}>
          {text.submitButton}
        </button>
      </form>
      {result === null && <p className="text-lg">{text.choose}</p>}
      {result && !result.ok && (
        <p role="alert" className={noticeClass("error")}>
          {text.errors[result.error]}
        </p>
      )}
      {result?.ok && result.people.length === 0 && <p className="text-lg">{text.noResults}</p>}
      {result?.ok && result.people.length > 0 && (
        <>
          <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {result.people.map((person) => (
              <li key={person.id} className={`${cardClass()} gap-2`} data-testid="person-result" data-person-id={person.id}>
                <p className="text-xl font-semibold">
                  <Link href={`/pessoas/${person.id}`} className={textLinkClass}>
                    {person.name ?? text.unreadableName}
                  </Link>
                </p>
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
                <p className="text-base text-ink-muted">{text.inCommon.replace("{count}", String(person.commonCount))}</p>
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
      <Link href={COORDINATION_PATH} className={`${textLinkClass()} self-center`}>
        {text.backLink}
      </Link>
    </PageShell>
  );
}
