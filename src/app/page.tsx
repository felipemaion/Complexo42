import { instance } from "@config/instance";
import { PageShell } from "@/modules/ui";

export default function Home() {
  return (
    <PageShell width="form" isCentered>
      <h1 className="text-3xl font-bold sm:text-4xl">{instance.home.title}</h1>
      <p className="max-w-prose text-lg text-ink-muted">{instance.home.message}</p>
    </PageShell>
  );
}
