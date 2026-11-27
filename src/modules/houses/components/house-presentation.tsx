// Apresentação de uma casa: descrição e "primeiros passos" com vídeos, tudo de config/ (R17).
// Só apresentação, sem estado: serve à tela do fluxo e à de quem já aceitou.

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
    <section className="flex flex-col gap-4" aria-labelledby="house-name">
      <p className="text-lg font-semibold">{title}</p>
      <h2 id="house-name" className="text-3xl font-bold" data-testid="house-name">
        {house.name}
      </h2>
      <p className="text-lg">{house.description}</p>
      <h3 className="text-xl font-semibold">{firstStepsTitle}</h3>
      <p className="whitespace-pre-line text-lg">{house.firstSteps.text}</p>
      {house.firstSteps.videoUrls.length > 0 && (
        <>
          <h3 className="text-xl font-semibold">{videosTitle}</h3>
          <ul className="list-disc pl-6 text-lg">
            {house.firstSteps.videoUrls.map((url) => (
              <li key={url}>
                <a href={url} target="_blank" rel="noopener noreferrer" className="underline">
                  {url}
                </a>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
