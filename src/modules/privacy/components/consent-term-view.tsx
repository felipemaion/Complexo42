import type { ConsentTerm } from "../domain/consent";

// O texto do termo (#11), vindo de config/consent.ts. Só apresentação: letra grande, títulos
// claros e listas curtas, para o público que inclui pessoas mais velhas.
export function ConsentTermView({ term }: Readonly<{ term: ConsentTerm }>) {
  return (
    <article className="flex flex-col gap-6" data-testid="consent-term" data-version={term.version}>
      <h1 className="text-3xl font-bold sm:text-4xl">{term.title}</h1>
      <p className="text-lg leading-relaxed">{term.intro}</p>
      {term.sections.map((section) => (
        <section key={section.heading} className="flex flex-col gap-3">
          <h2 className="text-xl font-bold sm:text-2xl">{section.heading}</h2>
          {section.paragraphs.map((paragraph) => (
            <p key={paragraph} className="text-lg leading-relaxed">
              {paragraph}
            </p>
          ))}
          {section.rows.length > 0 && (
            <dl className="flex flex-col gap-3">
              {section.rows.map((row) => (
                <div key={row.label}>
                  <dt className="text-lg font-semibold">{row.label}</dt>
                  <dd className="text-lg leading-relaxed text-ink-muted">{row.text}</dd>
                </div>
              ))}
            </dl>
          )}
          {section.bullets.length > 0 && (
            <ul className="list-disc space-y-2 pl-6 text-lg leading-relaxed marker:text-ink-muted">
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
