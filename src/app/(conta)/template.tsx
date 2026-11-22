import { ViewTransition } from "react";

// Troca de tela (22/11): só o conteúdo desliza e aparece; cabeçalho e menu ficam parados.
// As animações estão em globals.css (::view-transition-*(c42-pagina)) e somem com "menos movimento".
export default function AccountTemplate({ children }: Readonly<{ children: React.ReactNode }>) {
  return <ViewTransition name="c42-pagina">{children}</ViewTransition>;
}
