import type { Metadata } from "next";
import Link from "next/link";
import { instance } from "@config/instance";
import { sessionHouseClient } from "@/modules/houses";
import { badgeOrderField, badgeShownField, defaultBadgePrefs, readOwnBadgePrefs } from "@/modules/public-profile";
import { HOME_PATH } from "@/server/auth/routes";
import { requireUser } from "@/server/auth/session";
import { saveBadgePrefsAction } from "./actions";
import { buttonClass, cardClass, fieldClass, noticeClass, PageShell, textLinkClass } from "@/modules/ui";

export const metadata: Metadata = { title: instance.publicProfile.prefs.title };

// Medalhas do perfil público (#305): o dono escolhe quais aparecem e em que ordem (número menor primeiro).
export default async function BadgePrefsPage({ searchParams }: Readonly<{ searchParams: Promise<{ salvo?: string; erro?: string }> }>) {
  const user = await requireUser();
  const client = await sessionHouseClient();
  const text = instance.publicProfile;
  const query = await searchParams;
  const prefs = client ? await readOwnBadgePrefs(client, user.id) : [...defaultBadgePrefs];
  const errorText = query.erro ? (text.prefs.errors[query.erro as keyof typeof text.prefs.errors] ?? text.prefs.errors.failed) : null;
  return (
    <PageShell width="form">
      <h1 className="text-3xl font-bold sm:text-4xl">{text.prefs.title}</h1>
      <p className="max-w-prose text-lg text-ink-muted">{text.prefs.intro}</p>
      {query.salvo === "1" && (
        <p role="status" className={noticeClass("success")}>
          {text.prefs.saved}
        </p>
      )}
      {errorText && (
        <p role="alert" className={noticeClass("error")}>
          {errorText}
        </p>
      )}
      <form action={saveBadgePrefsAction} className={cardClass()}>
        {prefs.map((pref, index) => (
          <fieldset key={pref.kind} className="flex flex-col gap-2">
            <legend className="text-xl font-semibold">{text.badgeKinds[pref.kind]}</legend>
            <label className="flex min-h-12 items-center gap-3 text-lg">
              <input type="checkbox" name={badgeShownField(pref.kind)} defaultChecked={pref.shown} className="size-6 accent-primary" />
              {text.prefs.showLabel}
            </label>
            <label className="flex flex-col gap-1 text-lg font-semibold">
              {text.prefs.orderLabel}
              <input name={badgeOrderField(pref.kind)} type="number" min={1} max={99} required defaultValue={index + 1} className={fieldClass()} />
            </label>
          </fieldset>
        ))}
        <button type="submit" className={buttonClass("primary", "lg")}>
          {text.prefs.saveButton}
        </button>
      </form>
      <Link href={HOME_PATH} className={textLinkClass}>
        {text.prefs.backLink}
      </Link>
    </PageShell>
  );
}
