import type { Metadata } from "next";
import { instance } from "@config/instance";
import { AreaMap, readAreas, sessionAreaClient, type Areas } from "@/modules/map";
import { Card, Notice, PageShell } from "@/modules/ui";
import { requireUser } from "@/server/auth/session";
import { log } from "@/server/log";

export const metadata: Metadata = { title: instance.areaMap.title };

const EMPTY: Areas = { cities: new Map(), districts: [] };

// Onde estão as pessoas (#24, RF08): mapa por cidade da região metropolitana e lista por distrito
// da capital, só com contagens do escopo de quem coordena; menos de 5 aparece como "< 5".
export default async function AreaMapPage() {
  await requireUser();
  const text = instance.areaMap;
  const client = await sessionAreaClient();
  const areas = client
    ? await readAreas(client).catch((error: unknown) => {
        log.warn("areas_read_failed", { error: error instanceof Error ? error.message : "unknown" });
        return EMPTY;
      })
    : EMPTY;
  const cities = [...areas.cities.values()].sort((a, b) => (b.people ?? 0) - (a.people ?? 0));
  const show = (people: number | null) => (people === null ? text.few : String(people));

  return (
    <PageShell title={text.title} intro={text.intro} width="wide">
      <Notice tone="info">{text.privacyNote}</Notice>
      {cities.length === 0 ? (
        <p className="text-lg text-ink-muted">{text.empty}</p>
      ) : (
        <div className="grid gap-8 lg:grid-cols-12">
          <div className="lg:col-span-8">
            <AreaMap cities={areas.cities} label={text.mapLabel} fewLabel={text.few} />
          </div>
          <div className="flex flex-col gap-6 lg:col-span-4">
            <Card title={text.citiesTitle}>
              <ul className="flex flex-col gap-2">
                {cities.map((city) => (
                  <li key={city.label} className="flex justify-between gap-3 text-lg">
                    <span>{city.label}</span>
                    <strong className="text-primary">{show(city.people)}</strong>
                  </li>
                ))}
              </ul>
            </Card>
            {areas.districts.length > 0 && (
              <Card title={text.districtsTitle}>
                <ul className="flex flex-col gap-2">
                  {areas.districts.map((district) => (
                    <li key={district.label} className="flex justify-between gap-3 text-lg">
                      <span>{district.label}</span>
                      <strong className="text-primary">{show(district.people)}</strong>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </div>
        </div>
      )}
    </PageShell>
  );
}
