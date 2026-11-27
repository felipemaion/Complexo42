import { ViewTransition } from "react";

// Troca de tela (22/11): só o conteúdo desliza e aparece; cabeçalho e menu ficam parados.
// As animações estão em globals.css (::view-transition-*(c42-pagina)) e somem com "menos movimento".
// update="none" (27/11): só a TROCA de tela anima. Animando também a resposta de um formulário na mesma
// tela, o que a pessoa digitava durante a animação ia para a tela velha e se perdia (e2e/profile.spec.ts:
// bairro corrigido depois de um erro voltava ao valor errado).
export default function AccountTemplate({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <ViewTransition name="c42-pagina" update="none">
      {children}
    </ViewTransition>
  );
}
