import { instance } from "@config/instance";
import { BrandMark, buttonClass, PageShell } from "@/modules/ui";

// Montada a cada visita: o modo demonstração vem do ambiente do servidor, não da compilação.
export const dynamic = "force-dynamic";

// Fora da demonstração: a página "em construção" de sempre. Com DEMO_MODE=1 (só no servidor de
// demonstração, pessoas fictícias): a escolha entre ver como membro ou como coordenação.
export default function Home() {
  if (process.env.DEMO_MODE !== "1") {
    return (
      <PageShell title={instance.home.title} intro={instance.home.message}>
        {null}
      </PageShell>
    );
  }
  const demo = instance.demo;
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col justify-center gap-8 px-5 py-10">
      <header className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <BrandMark shortName={instance.shortName} />
          <p className="text-xl font-bold">{instance.name}</p>
        </div>
        <h1 className="text-4xl font-bold leading-tight text-ink">{demo.title}</h1>
        <p className="text-xl text-ink-muted">{demo.intro}</p>
      </header>
      <div className="grid gap-4 sm:grid-cols-2">
        <section className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-6">
          <p className="text-lg text-ink-muted">{demo.memberHint}</p>
          <a href="/demo?papel=membro" className={`${buttonClass("primary")} mt-auto no-underline`}>
            {demo.asMember}
          </a>
        </section>
        <section className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-6">
          <p className="text-lg text-ink-muted">{demo.coordinatorHint}</p>
          <a href="/demo?papel=coordenacao" className={`${buttonClass("secondary")} mt-auto no-underline`}>
            {demo.asCoordinator}
          </a>
        </section>
      </div>
    </main>
  );
}
