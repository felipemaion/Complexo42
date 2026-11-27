"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { parentPath } from "../domain/parent-path";

type Props = { homePath: string; labels: { nav: string; home: string; back: string } };

const linkClass = "rounded-xl border-2 border-current px-5 py-3 text-lg font-semibold focus:outline-none focus-visible:ring-4 focus-visible:ring-offset-2";

/**
 * "Início" sempre à vista e, fora da página inicial, "Voltar" para a página-mãe (#205). Links
 * reais, não `history.back()`: funcionam também em quem abriu a página por link direto.
 */
export function AccountNav({ homePath, labels }: Props) {
  const pathname = usePathname();
  const parent = parentPath(pathname);
  return (
    <nav aria-label={labels.nav} className="flex flex-wrap items-center gap-3">
      {parent !== null && (
        <Link href={parent} className={linkClass} data-testid="nav-back">
          {labels.back}
        </Link>
      )}
      <Link href={homePath} className={linkClass} aria-current={parent === null ? "page" : undefined} data-testid="nav-home">
        {labels.home}
      </Link>
    </nav>
  );
}
