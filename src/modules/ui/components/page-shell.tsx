import { pageContainerClass, type PageWidth } from "../domain/styles";

type Props = Readonly<{
  width: PageWidth;
  children: React.ReactNode;
  /** Centraliza o conteúdo na altura da tela (páginas curtas, sem cabeçalho). */
  isCentered?: boolean;
}>;

/** O <main> de toda página (#324): largura pelo tipo de página e espaçamento vertical padrão. */
export function PageShell({ width, children, isCentered = false }: Props) {
  const layout = isCentered ? "flex min-h-screen flex-col justify-center" : "flex flex-col";
  return <main className={`${pageContainerClass(width)} ${layout} gap-6 py-8 sm:py-12`}>{children}</main>;
}
