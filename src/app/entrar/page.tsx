import type { Metadata } from "next";
import { AppLogoHero } from "@/modules/houses/components/house-shield";
import { instance } from "@config/instance";
import { submitLoginForm } from "@/server/auth/actions";
import { parseAuthErrorCode } from "@/server/auth/errors";
import { GOOGLE_PATH } from "@/server/auth/routes";
import { getTurnstileConfig } from "@/server/auth/turnstile";
import { TurnstileWidget } from "./turnstile-widget";

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
  const notice = error ? text.errors[error] : params.enviado === "1" ? text.emailSent : params.enviado === "2" ? text.recoverySent : params.saiu === "1" ? text.signedOut : null;

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-8 p-6">
      <header className="flex flex-col items-center gap-3 text-center">
        <AppLogoHero name={instance.name} />
        <p className="text-2xl font-bold" data-testid="app-name">
          {instance.name}
        </p>
        <h1 className="text-3xl font-bold">{text.title}</h1>
        <p className="text-lg">{text.intro}</p>
      </header>

      {notice && (
        <p role={error ? "alert" : "status"} className="rounded-lg border-2 border-current p-4 text-lg">
          {notice}
        </p>
      )}

      {/* GET para o servidor (GOOGLE_PATH): navegação real, não server action (o POST do roteador dá 405 no Auth). */}
      <form method="get" action={GOOGLE_PATH}>
        <input type="hidden" name="next" value={next} />
        <button type="submit" className={`${bigButton} text-white`} style={{ backgroundColor: "var(--color-primary)" }}>
          {text.googleButton}
        </button>
      </form>

      {/* Um formulário só, com o Turnstile (#116) uma vez: cada botão manda o seu `intent` (submitLoginForm). A
          senha é opcional no HTML porque o botão do link não a usa; quem a deixa vazia recebe a
          mesma resposta genérica de senha errada (ADR 0018 §3). */}
      <form action={submitLoginForm} className="flex flex-col gap-3">
        <input type="hidden" name="next" value={next} />
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
        <label htmlFor="password" className="text-lg font-medium">
          {text.passwordLabel}
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          maxLength={256}
          className="w-full rounded-xl border-2 border-neutral-400 bg-transparent px-4 py-4 text-xl"
        />
        <TurnstileWidget siteKey={getTurnstileConfig().siteKey} />
        <noscript>
          <p className="text-lg">{text.emailNeedsScript}</p>
        </noscript>
        <button type="submit" name="intent" value="password" className={`${bigButton} border-2 border-current`}>
          {text.passwordButton}
        </button>
        <button type="submit" name="intent" value="link" className={`${bigButton} border-2 border-current`}>
          {text.emailButton}
        </button>
        <button type="submit" name="intent" value="recover" className="px-2 py-3 text-lg underline">
          {text.recoverButton}
        </button>
      </form>
    </main>
  );
}
