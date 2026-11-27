// "Quem vê meu contato" (issue #119, ADR 0010). Só apresentação: cada opção é um botão grande
// de um formulário que vai para a server action; quem valida e grava é o servidor. Funciona
// sem JavaScript (o formulário é um POST comum), e a escolha atual fica marcada.
import { contactKinds, contactScopes, describeContactView, type ContactKind, type ContactScope, type ContactView, type ContactViewText, type ContactVisibility } from "../domain/contact";

export type ContactVisibilityText = ContactViewText & {
  kinds: Record<ContactKind, string>;
  scopes: Record<ContactScope, string>;
  explain: Record<ContactScope, string>;
  viewsTitle: string;
  viewsEmpty: string;
  viewsNote: string;
};

const button =
  "block w-full rounded-xl border-2 border-primary bg-surface text-primary no-underline px-5 py-4 text-left text-xl font-semibold focus:outline-none focus-visible:ring-4 focus-visible:ring-focus focus-visible:ring-offset-2";

type ChoicesProps = {
  visibility: ContactVisibility;
  action: (formData: FormData) => Promise<void>;
  text: ContactVisibilityText;
};

export function ContactVisibilityChoices({ visibility, action, text }: ChoicesProps) {
  return (
    <div className="flex flex-col gap-8">
      {contactKinds.map((kind) => (
        <form key={kind} action={action} className="flex flex-col gap-3" data-testid={`contact-kind-${kind}`}>
          <fieldset className="flex flex-col gap-3">
            <legend className="mb-2 text-2xl font-bold">{text.kinds[kind]}</legend>
            <input type="hidden" name="kind" value={kind} />
            {contactScopes.map((scope) => {
              const current = visibility[kind] === scope;
              return (
                <button
                  key={scope}
                  type="submit"
                  name="scope"
                  value={scope}
                  aria-pressed={current}
                  className={`${button} ${current ? "bg-primary text-on-primary" : ""}`}
                >
                  <span aria-hidden="true">{current ? "● " : "○ "}</span>
                  {text.scopes[scope]}
                </button>
              );
            })}
            <p className="text-lg" aria-live="polite">
              {text.explain[visibility[kind]]}
            </p>
          </fieldset>
        </form>
      ))}
    </div>
  );
}

export function ContactViewsList({ views, text }: { views: readonly ContactView[]; text: ContactVisibilityText }) {
  return (
    <section aria-labelledby="contact-views-title" className="flex flex-col gap-3">
      <h2 id="contact-views-title" className="text-2xl font-bold">
        {text.viewsTitle}
      </h2>
      {views.length === 0 ? (
        <p className="text-lg">{text.viewsEmpty}</p>
      ) : (
        <>
          <ul className="flex flex-col gap-2 text-lg" data-testid="contact-views">
            {views.map((view, index) => (
              <li key={`${view.viewedAt}-${index}`}>{describeContactView(view, text)}</li>
            ))}
          </ul>
          <p className="text-base">{text.viewsNote}</p>
        </>
      )}
    </section>
  );
}
