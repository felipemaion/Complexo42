import type { Metadata } from "next";
import Link from "next/link";
import { instance } from "@config/instance";
import {
  listSkills,
  PersonList,
  SearchForm,
  searchPeople,
  sessionSearchClient,
} from "@/modules/search";
import { Notice, PageShell } from "@/modules/ui";
import { requireUser } from "@/server/auth/session";
import { decryptField } from "@/server/crypto";

export const metadata: Metadata = { title: instance.search.title };

type Props = {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function SearchBySkillPage({ searchParams }: Props) {
  await requireUser();
  const text = instance.search;
  const params = await searchParams;

  const rawH = params.h;
  const skillIds: readonly string[] = Array.isArray(rawH)
    ? rawH
    : typeof rawH === "string"
      ? [rawH]
      : [];

  const client = await sessionSearchClient();
  const skills = client ? await listSkills(client) : [];

  const hasSearched = skillIds.length > 0;
  const result =
    hasSearched && client
      ? await searchPeople(
          client,
          { skillIds },
          (value, profileId) =>
            decryptField(value, {
              table: "profiles",
              column: "display_name_enc",
              rowId: profileId,
            }),
        )
      : null;

  return (
    <PageShell title={text.title} intro={text.intro} width="wide">
      {/* No computador: habilidades à esquerda, pessoas encontradas à direita. */}
      <div className="grid gap-8 lg:grid-cols-12">
        <div className="lg:col-span-5">
          <SearchForm skills={skills} selected={skillIds} text={text} />
        </div>

        <div className="flex flex-col gap-4 lg:col-span-7">
          {result && !result.ok && (
            <Notice tone="error">{text.errors[result.error]}</Notice>
          )}

          {result && result.ok && (
            <>
              <h2 className="text-xl font-bold">{text.resultsTitle}</h2>
              <PersonList people={result.value} text={text} />
            </>
          )}
        </div>
      </div>

      <Link href="/inicio" className="text-lg">
        {instance.coordination.homeBackLink}
      </Link>
    </PageShell>
  );
}
