// Classes dos componentes comuns (#324). Só tokens de src/app/globals.css: trocar a paleta, a fonte ou
// o raio é mexer lá, não aqui. Funções puras para valer igual em <button>, <Link> e <a>.

export type PageWidth = "form" | "content" | "wide";
export type ButtonVariant = "primary" | "secondary" | "danger" | "choice";
export type ButtonSize = "md" | "lg";
export type NoticeTone = "info" | "error" | "success";

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
  primary: "justify-center text-center border-transparent bg-primary text-on-primary hover:brightness-110",
  secondary: "justify-center text-center border-field bg-surface text-ink hover:bg-soft",
  danger: "justify-center text-center border-danger bg-surface text-danger hover:bg-danger-soft",
  // Alternativa de uma lista (atividades, casas): texto à esquerda, como item de menu.
  choice: "justify-start text-left border-field bg-surface text-ink hover:border-primary-ink hover:bg-soft",
};

const buttonSizeClass: Readonly<Record<ButtonSize, string>> = {
  md: "min-h-target px-4 py-2 text-base",
  lg: "min-h-14 w-full px-6 py-3 text-lg",
};

/** Botão ou link com cara de botão: alvo de toque ≥ 44 px, foco e desabilitado pelos tokens. */
export function buttonClass(variant: ButtonVariant = "secondary", size: ButtonSize = "md"): string {
  return [
    "inline-flex items-center gap-2 rounded-control border-2 font-semibold no-underline transition-colors",
    buttonVariantClass[variant],
    buttonSizeClass[size],
  ].join(" ");
}

/** Link com cara de link, mas com alvo de toque de botão (ações secundárias: "Esqueci a senha", "Excluir minha conta"). */
export function textLinkClass(): string {
  return "inline-flex min-h-target items-center justify-center px-2 text-lg text-link underline";
}

/** Cartão: a superfície que agrupa um formulário ou um bloco da página. */
export function cardClass(): string {
  return "flex flex-col gap-5 rounded-card border border-line bg-surface p-4 shadow-card sm:p-8";
}

/** Campo de texto: borda de 3:1 com o fundo (WCAG 1.4.11) e altura de alvo de toque. */
export function fieldClass(): string {
  return "w-full min-h-target rounded-control border-2 border-field bg-surface px-4 py-3 text-lg text-ink";
}

const noticeToneClass: Readonly<Record<NoticeTone, string>> = {
  info: "border-line bg-soft",
  error: "border-danger bg-danger-soft",
  success: "border-success bg-success-soft",
};

/** Aviso (status, erro, sucesso): o tom vem da borda e do fundo; o texto fica na cor de leitura. */
export function noticeClass(tone: NoticeTone): string {
  return `rounded-control border-2 p-4 text-lg text-ink ${noticeToneClass[tone]}`;
}
