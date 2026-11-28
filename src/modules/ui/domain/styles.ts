// Classes dos componentes comuns (#324). Só tokens de src/app/globals.css: trocar a paleta, a fonte ou
// o raio é mexer lá, não aqui. Funções puras para valer igual em <button>, <Link> e <a>.

export type PageWidth = "form" | "content" | "wide";
export type ButtonVariant = "primary" | "secondary" | "danger";
export type ButtonSize = "md" | "lg";

const pageWidthClass: Readonly<Record<PageWidth, string>> = {
  // Login, termo, perfil, senha: uma coluna de leitura confortável.
  form: "max-w-form",
  // Casa, início, questionário: duas colunas no computador.
  content: "max-w-content",
  // Coordenação, listas e resultados: a largura do site.
  wide: "max-w-site",
};

/** Container da página: centralizado, com respiro lateral que cresce com a tela. */
export function pageContainerClass(width: PageWidth): string {
  return `mx-auto w-full ${pageWidthClass[width]} px-4 sm:px-6 lg:px-10`;
}

const buttonVariantClass: Readonly<Record<ButtonVariant, string>> = {
  primary: "border-transparent bg-primary text-on-primary hover:brightness-110",
  secondary: "border-field bg-surface text-ink hover:bg-soft",
  danger: "border-danger bg-surface text-danger hover:bg-danger-soft",
};

const buttonSizeClass: Readonly<Record<ButtonSize, string>> = {
  md: "min-h-target px-4 py-2 text-base",
  lg: "min-h-14 w-full px-6 py-3 text-lg",
};

/** Botão ou link com cara de botão: alvo de toque ≥ 44 px, foco e desabilitado pelos tokens. */
export function buttonClass(variant: ButtonVariant = "secondary", size: ButtonSize = "md"): string {
  return [
    "inline-flex items-center justify-center gap-2 rounded-control border-2 text-center font-semibold no-underline transition-colors",
    buttonVariantClass[variant],
    buttonSizeClass[size],
  ].join(" ");
}
