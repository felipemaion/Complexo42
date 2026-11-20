import { PageShell } from "@/modules/ui";
import { instance } from "@config/instance";

export default function Home() {
  return (
    <PageShell title={instance.home.title} intro={instance.home.message}>
      {null}
    </PageShell>
  );
}
