// Apresentação de uma casa: descrição e "primeiros passos" com vídeos, tudo de config/ (R17).
// Só apresentação, sem estado: serve à tela do fluxo e à de quem já aceitou.

import { HouseHero } from "./house-shield";

export type HouseView = {
  id: string;
  name: string;
  description: string;
  /** Cor da casa no gráfico (#201): `light` e `dark`, CSS `light-dark()`. */
  color: { light: string; dark: string };
  activities: readonly string[];
  firstSteps: { text: string; videoUrls: readonly string[] };
};

type Props = {
  house: HouseView;
  title: string;
  firstStepsTitle: string;
  videosTitle: string;
};

export function HousePresentation({ house, title, firstStepsTitle, videosTitle }: Readonly<Props>) {
  return (
    // No computador, o brasão à esquerda e o texto à direita (#324); no celular, um embaixo do outro.
    <section className="grid gap-6 md:grid-cols-[14rem_1fr] md:items-start" aria-labelledby="house-name">
      <div className="flex flex-col items-center gap-2">
        <p className="text-base font-semibold text-ink-muted">{title}</p>
        <HouseHero houseId={house.id} name={house.name} headingId="house-name" />
      </div>
      <div className="flex min-w-0 flex-col gap-4">
        <p className="max-w-prose text-lg">{house.description}</p>
        <h3 className="text-xl font-bold">{firstStepsTitle}</h3>
        <p className="max-w-prose whitespace-pre-line text-lg">{house.firstSteps.text}</p>
        {house.firstSteps.videoUrls.length > 0 && (
          <>
            <h3 className="text-xl font-bold">{videosTitle}</h3>
            <ul className="list-disc pl-6 text-lg">
              {house.firstSteps.videoUrls.map((url) => (
                <li key={url} className="break-words">
                  <a href={url} target="_blank" rel="noopener noreferrer" className="text-link underline">
                    {url}
                  </a>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </section>
  );
}
