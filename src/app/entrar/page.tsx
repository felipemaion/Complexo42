import type { Metadata } from "next";
import { instance } from "@config/instance";
import { sendMagicLink, signInWithGoogle } from "@/server/auth/actions";
import { parseAuthErrorCode } from "@/server/auth/errors";

export const metadata: Metadata = { title: instance.auth.title };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

// Botões grandes e tudo à vista, sem menu nem etapa escondida (pedido do stakeholder).
const bigButton =
  "block w-full rounded-xl px-6 py-5 text-center text-xl font-semibold focus:outline-none focus-visible:ring-4 focus-visible:ring-offset-2";

export default async function LoginPage({ searchParams }: Props) {
  const params = await searchParams;
  const text = instance.auth;
  // Só códigos conhecidos viram mensagem; texto da URL nunca é exibido.
  const error = parseAuthErrorCode(params.erro);
  const next = typeof params.next === "string" ? params.next : "";
  const notice = error ? text.errors[error] : params.enviado === "1" ? text.emailSent : params.saiu === "1" ? text.signedOut : null;

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-8 p-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold">{text.title}</h1>
        <p className="text-lg">{text.intro}</p>
      </header>

      {notice && (
        <p role={error ? "alert" : "status"} className="rounded-lg border-2 border-current p-4 text-lg">
          {notice}
        </p>
      )}

      <form action={signInWithGoogle}>
        <input type="hidden" name="next" value={next} />
        <button type="submit" className={`${bigButton} text-white`} style={{ backgroundColor: "var(--color-primary)" }}>
          {text.googleButton}
        </button>
      </form>

      <form action={sendMagicLink} className="flex flex-col gap-3">
        <label htmlFor="email" className="text-lg font-medium">
          {text.emailLabel}
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          inputMode="email"
          maxLength={254}
          className="w-full rounded-xl border-2 border-neutral-400 bg-transparent px-4 py-4 text-xl"
        />
        <button type="submit" className={`${bigButton} border-2 border-current`}>
          {text.emailButton}
        </button>
      </form>
    </main>
  );
}
