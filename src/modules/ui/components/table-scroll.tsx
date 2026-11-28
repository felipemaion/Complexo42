type Props = Readonly<{
  /** Nome da região para leitor de tela (o título da tabela). */
  label: string;
  children: React.ReactNode;
}>;

/**
 * Tabela larga no celular (#324): rola dentro da própria caixa, sem rolar a página de lado. A região é
 * focável e tem nome, para quem usa teclado conseguir rolar (axe: scrollable-region-focusable).
 */
export function TableScroll({ label, children }: Props) {
  return (
    <div role="region" aria-label={label} tabIndex={0} className="max-w-full overflow-x-auto rounded-card border border-line bg-surface p-4 shadow-card sm:p-6">
      {children}
    </div>
  );
}
