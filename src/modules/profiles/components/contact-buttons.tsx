"use client";
// "Ver contato" de outra pessoa (#48, ADR 0010). Só apresentação: cada botão é um clique (POST) numa server action;
// o servidor decide, decifra e registra. Só aparecem os botões dos contatos que `contact_access` liberou. O valor só
// existe nesta tela depois do clique, nunca em lista nem em URL. O texto de "sem permissão" é o mesmo para qualquer
// motivo (a permissão pode ter mudado entre a tela e o clique).
import { useActionState } from "react";
import { buttonClass, noticeClass } from "@/modules/ui";
import { contactKinds, type ContactAccess, type ContactKind, type ViewContactState } from "../domain/contact";
import { SocialLinkList } from "./social-links";

export type ContactButtonsText = {
  title: string;
  note: string;
  buttons: Record<ContactKind, string>;
  openWhatsapp: string;
  socialLabel: string;
  empty: string;
  forbidden: string;
  rateLimited: string;
  failed: string;
};

type Props = {
  targetId: string;
  access: ContactAccess;
  action: (previous: ViewContactState, formData: FormData) => Promise<ViewContactState>;
  text: ContactButtonsText;
};

const button = buttonClass("secondary", "lg");
const IDLE: ViewContactState = { status: "idle" };

export function ContactButtons({ targetId, access, action, text }: Props) {
  const [state, formAction, pending] = useActionState(action, IDLE);
  const kinds = contactKinds.filter((kind) => access[kind]);
  if (kinds.length === 0) return null;
  return (
    <section aria-labelledby="contato-titulo" className="flex flex-col gap-3">
      <h2 id="contato-titulo" className="text-2xl font-semibold">
        {text.title}
      </h2>
      <p className="text-base text-ink-muted">{text.note}</p>
      <form action={formAction} className="flex flex-wrap gap-3">
        <input type="hidden" name="alvo" value={targetId} />
        {kinds.map((kind) => (
          <button key={kind} type="submit" name="tipo" value={kind} disabled={pending} className={button} data-testid={`ver-contato-${kind}`}>
            {text.buttons[kind]}
          </button>
        ))}
      </form>
      <div aria-live="polite" className="flex flex-col gap-2">
        {state.status === "forbidden" && <p className={noticeClass("error")}>{text.forbidden}</p>}
        {state.status === "rate_limited" && <p className={noticeClass("error")}>{text.rateLimited}</p>}
        {state.status === "failed" && <p className={noticeClass("error")}>{text.failed}</p>}
        {state.status === "ok" && state.empty && <p className={noticeClass("info")}>{text.empty}</p>}
        {state.status === "ok" && state.whatsapp && (
          <p className="flex flex-col gap-2 text-lg" data-testid="contato-whatsapp">
            <span>{state.whatsapp.display}</span>
            {state.whatsapp.href && (
              <a href={state.whatsapp.href} target="_blank" rel="noopener noreferrer" className={buttonClass("primary", "lg")}>
                {text.openWhatsapp}
              </a>
            )}
          </p>
        )}
        {state.status === "ok" && state.social && <SocialLinkList links={state.social} label={text.socialLabel} newTab />}
        {state.status === "ok" && state.email && (
          <p className="text-lg" data-testid="contato-email">
            {state.email.href ? (
              <a href={state.email.href} className="text-link underline">
                {state.email.address}
              </a>
            ) : (
              state.email.address
            )}
          </p>
        )}
      </div>
    </section>
  );
}
