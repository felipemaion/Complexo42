import { instance } from "@config/instance";

// Carregamento (22/11): esqueleto do tamanho da página, sem "pulo" quando o conteúdo chega.
// O texto fica só para leitor de tela; o brilho some com "menos movimento".
export default function AccountLoading() {
  return (
    <main className="mx-auto flex w-full max-w-site flex-col gap-6 px-5 py-10" aria-busy="true">
      <p className="sr-only" role="status">{instance.site.loading}</p>
      <div className="c42-esqueleto h-12 w-2/3 rounded-xl" />
      <div className="c42-esqueleto h-6 w-1/2 rounded-lg" />
      <div className="grid gap-4 md:grid-cols-3">
        <div className="c42-esqueleto h-32 rounded-2xl" />
        <div className="c42-esqueleto h-32 rounded-2xl" />
        <div className="c42-esqueleto h-32 rounded-2xl" />
      </div>
      <div className="c42-esqueleto h-64 rounded-2xl" />
    </main>
  );
}
