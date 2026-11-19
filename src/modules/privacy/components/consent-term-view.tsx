import type { ConsentTerm } from "../domain/consent";

// O texto do termo (#11), vindo de config/consent.ts. Só apresentação: letra grande, títulos
// claros e listas curtas, para o público que inclui pessoas mais velhas.
export function ConsentTermView({ term }: Readonly<{ term: ConsentTerm }>) {
  return (
    <article className="flex flex-col gap-6" data-testid="consent-term" data-version={term.version}>
      <h1 className="text-3xl font-bold">{term.title}</h1>
      <p className="text-xl leading-relaxed">{term.intro}</p>
      {term.sections.map((section) => (
        <section key={section.heading} className="flex flex-col gap-3">
          <h2 className="text-2xl font-semibold">{section.heading}</h2>
          {section.paragraphs.map((paragraph) => (
            <p key={paragraph} className="text-xl leading-relaxed">
              {paragraph}
            </p>
          ))}
          {section.rows.length > 0 && (
            <dl className="flex flex-col gap-3">
              {section.rows.map((row) => (
                <div key={row.label}>
                  <dt className="text-xl font-semibold">{row.label}</dt>
                  <dd className="text-xl leading-relaxed">{row.text}</dd>
                </div>
              ))}
            </dl>
          )}
          {section.bullets.length > 0 && (
            <ul className="list-disc space-y-2 pl-6 text-xl leading-relaxed">
              {section.bullets.map((bullet) => (
                <li key={bullet}>{bullet}</li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </article>
  );
}
