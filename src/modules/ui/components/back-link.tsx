import Link from "next/link";

type BackLinkProps = {
  readonly href: string;
  readonly label: string;
};

// "Voltar para…" de fim de página (22/11): um só desenho para o site todo, com seta e área de toque
// de 48 px (antes cada página fazia o seu, com 32 px; achado pelo revisor de design).
export function BackLink({ href, label }: BackLinkProps) {
  return (
    <Link href={href} className="group inline-flex min-h-12 items-center gap-2 self-start text-lg font-semibold">
      <span aria-hidden="true" className="transition-transform duration-200 group-hover:-translate-x-1 motion-reduce:transition-none">
        ←
      </span>
      {label}
    </Link>
  );
}
