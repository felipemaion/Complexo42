import { socialLinkRel, socialLinkViews } from "../domain/social";

// Lista de links de rede (#17): o ÚNICO jeito de mostrar redes de alguém na tela (o próprio
// perfil agora; o contato de outra pessoa, ADR 0010, depois). Cada link passa de novo pela regra
// de `domain/social.ts` (só https, sem usuário/senha) e aparece como texto puro (domínio +
// caminho): o React escapa o texto, e HTML cru é proibido pelo ESLint.

type Props = {
  /** Os links guardados (já decifrados no servidor). Os que não passam na regra não aparecem. */
  links: readonly string[];
  /** Nome da lista para leitor de tela. */
  label: string;
  /** Abrir em outra aba. Só quando a tela pedir; o padrão é abrir na mesma aba. */
  newTab?: boolean;
};

export function SocialLinkList({ links, label, newTab = false }: Props) {
  const views = socialLinkViews(links);
  if (views.length === 0) return null;
  return (
    <ul aria-label={label} className="flex flex-col gap-3">
      {views.map((view) => (
        <li key={view.href}>
          <a
            href={view.href}
            rel={socialLinkRel}
            title={view.href}
            target={newTab ? "_blank" : undefined}
            className="text-lg break-all text-link underline"
          >
            {view.text}
          </a>
        </li>
      ))}
    </ul>
  );
}
