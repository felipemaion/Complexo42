import { instance } from "@config/instance";
import { WaveBackdrop } from "@/modules/landing";
import { BrandMark, buttonClass, SoundToggle } from "@/modules/ui";
import { LOGIN_PATH } from "@/server/auth/routes";
import "@/modules/landing/landing.css";

// Montada a cada visita: o modo demonstração vem do ambiente do servidor, não da compilação.
export const dynamic = "force-dynamic";

// Entrada "Cinema" (22/11, escolhida pelo dono): abertura com cortina, fundo em ondas douradas,
// frase gigante que sobe, lista numerada que entra com a rolagem e faixa dourada que se abre.
// O movimento é do próprio navegador (CSS ligado à rolagem, landing.css): sem biblioteca nova, e
// quem não tem suporte ou pediu "menos movimento" vê tudo parado e legível.
// Fora da demonstração o convite é "Entrar"; com DEMO_MODE=1, a escolha entre membro e coordenação.
// Texto solto sobre as ondas usa a cor principal (text-ink), não a apagada: o fundo varia de tom.
export default function Home() {
  const home = instance.home;
  const isDemo = process.env.DEMO_MODE === "1";
  const lastLine = home.hero.length - 1;
  return (
    <main className="cine">
      <div className="cine-curtain" aria-hidden="true">
        <BrandMark shortName={instance.shortName} />
      </div>
      <div className="cine-progress" aria-hidden="true" />
      <WaveBackdrop />
      <div className="cine-grain" aria-hidden="true" />

      <div className="cine-wrap">
        <header className="cine-top">
          <div className="flex items-center gap-3">
            <BrandMark shortName={instance.shortName} />
            <p className="text-lg font-bold text-ink">{instance.name}</p>
          </div>
          <SoundToggle label={instance.site.sound} isCompactOnPhone />
        </header>

        <section className="cine-hero" aria-labelledby="cine-title">
          <p className="cine-eyebrow">[ {home.eyebrow} ]</p>
          <h1 id="cine-title" className="cine-big">
            {home.hero.map((line, i) => (
              <span key={line} className="cine-line">
                <span>
                  {line}
                  {i === lastLine && (
                    <>
                      {" "}
                      <em className="cine-accent">{home.heroAccent}</em>
                    </>
                  )}
                </span>
                {i < lastLine && " "}
              </span>
            ))}
          </h1>
        </section>

        <section className="cine-list" aria-labelledby="cine-list-title">
          <h2 id="cine-list-title" className="cine-tag">{home.listTitle}</h2>
          <ol>
            {home.items.map((item, i) => (
              <li key={item.title} className="cine-item">
                <details>
                  <summary>
                    <span className="cine-no">[{String(i + 1).padStart(2, "0")}]</span>
                    <span className="cine-item-title">{item.title}</span>
                    <span aria-hidden="true" className="cine-plus">+</span>
                  </summary>
                  <p>{item.detail}</p>
                </details>
              </li>
            ))}
          </ol>
        </section>
      </div>

      <section className="cine-wipe" aria-labelledby="cine-wipe-text">
        <div className="cine-wrap">
          <p id="cine-wipe-text">
            {home.wipe} <em className="cine-accent">{home.wipeAccent}</em>
          </p>
        </div>
      </section>

      <section className="cine-wrap cine-cta" aria-labelledby="cine-cta-title">
        <h2 id="cine-cta-title" className="cine-cta-title">
          {home.ctaTitle} <em className="cine-accent">{home.ctaAccent}</em>
        </h2>
        {isDemo ? <DemoChoice /> : <EnterLink />}
      </section>

      <footer className="cine-wrap cine-foot">
        <p className="text-base text-ink">{instance.site.privacyNote}</p>
      </footer>
    </main>
  );
}

function EnterLink() {
  const home = instance.home;
  return (
    <div className="flex flex-col items-start gap-3">
      <a href={LOGIN_PATH} className={`${buttonClass("primary", { isFullWidth: false })} cine-arrow no-underline`}>
        {home.enterButton}
        <span aria-hidden="true">→</span>
      </a>
      <p className="text-lg text-ink">{home.enterHint}</p>
    </div>
  );
}

// Demonstração (pessoas fictícias): os dois jeitos de ver a plataforma, com o que cada um mostra.
function DemoChoice() {
  const demo = instance.demo;
  return (
    <div className="flex flex-col gap-6">
      <p className="text-xl text-ink">{demo.intro}</p>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-6">
          <p className="text-lg text-ink-muted">{demo.memberHint}</p>
          <a href="/demo?papel=membro" className={`${buttonClass("primary")} cine-arrow mt-auto no-underline`}>
            {demo.asMember}
            <span aria-hidden="true">→</span>
          </a>
        </div>
        <div className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-6">
          <p className="text-lg text-ink-muted">{demo.coordinatorHint}</p>
          <a href="/demo?papel=coordenacao" className={`${buttonClass("secondary")} cine-arrow mt-auto no-underline`}>
            {demo.asCoordinator}
            <span aria-hidden="true">→</span>
          </a>
        </div>
      </div>
    </div>
  );
}
