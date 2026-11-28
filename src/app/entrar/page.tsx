import type { Metadata } from "next";
import { AppLogoHero } from "@/modules/houses/components/house-shield";
import { instance } from "@config/instance";
import { submitLoginForm } from "@/server/auth/actions";
import { getAuthConfig } from "@/server/auth/config";
import { parseAuthErrorCode } from "@/server/auth/errors";
import { GOOGLE_PATH } from "@/server/auth/routes";
import { isSignupClosed } from "@/server/auth/signup-status";
import { getTurnstileConfig } from "@/server/auth/turnstile";
import { buttonClass, cardClass, fieldClass, noticeClass, PageShell, textLinkClass } from "@/modules/ui";
import { TurnstileWidget } from "./turnstile-widget";

export const metadata: Metadata = { title: instance.auth.title };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

// Botões grandes e tudo à vista, sem menu nem etapa escondida (pedido do stakeholder). Uma coluna
// centralizada também no computador (e2e/auth.spec.ts): o formulário fica num cartão (#324).

export default async function LoginPage({ searchParams }: Props) {
  const params = await searchParams;
  const text = instance.auth;
  // Só códigos conhecidos viram mensagem; texto da URL nunca é exibido.
  const error = parseAuthErrorCode(params.erro);
  const next = typeof params.next === "string" ? params.next : "";
  // Estado global do cadastro (#332): o mesmo aviso para todos, nunca por e-mail (M4).
  const signupClosed = await isSignupClosed(getAuthConfig());
  const notice = error ? text.errors[error] : params.enviado === "1" ? text.emailSent : params.enviado === "2" ? text.recoverySent : params.saiu === "1" ? text.signedOut : null;

  return (
    <PageShell width="form" isCentered>
      <header className="flex flex-col items-center gap-3 text-center">
        <AppLogoHero name={instance.name} />
        <p className="font-display text-2xl font-bold" data-testid="app-name">
          {instance.name}
        </p>
        <h1 className="text-3xl font-bold sm:text-4xl">{text.title}</h1>
        <p className="max-w-prose text-lg text-ink-muted">{text.intro}</p>
      </header>

      {signupClosed && (
        <p className="text-lg" data-testid="signup-closed">
          {text.signupClosed}
        </p>
      )}

      {notice && (
        <p role={error ? "alert" : "status"} className={noticeClass(error ? "error" : "info")}>
          {notice}
        </p>
      )}

      <div className={cardClass()}>
        {/* GET para o servidor (GOOGLE_PATH): navegação real, não server action (o POST do roteador dá 405 no Auth). */}
        <form method="get" action={GOOGLE_PATH}>
          <input type="hidden" name="next" value={next} />
          <button type="submit" className={buttonClass("primary", "lg")}>
            {text.googleButton}
          </button>
        </form>

        {/* Um formulário só, com o Turnstile (#116) uma vez: cada botão manda o seu `intent` (submitLoginForm). A
            senha é opcional no HTML porque o botão do link não a usa; quem a deixa vazia recebe a
            mesma resposta genérica de senha errada (ADR 0018 §3). */}
        <form action={submitLoginForm} className="flex flex-col gap-3 border-t border-line pt-5">
          <input type="hidden" name="next" value={next} />
          <label htmlFor="email" className="text-lg font-semibold">
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
            className={fieldClass()}
          />
          <label htmlFor="password" className="mt-2 text-lg font-semibold">
            {text.passwordLabel}
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            maxLength={256}
            className={fieldClass()}
          />
          <TurnstileWidget siteKey={getTurnstileConfig().siteKey} />
          <noscript>
            <p className="text-lg">{text.emailNeedsScript}</p>
          </noscript>
          <button type="submit" name="intent" value="password" className={buttonClass("secondary", "lg")}>
            {text.passwordButton}
          </button>
          <button type="submit" name="intent" value="link" className={buttonClass("secondary", "lg")}>
            {text.emailButton}
          </button>
          <button type="submit" name="intent" value="recover" className={textLinkClass()}>
            {text.recoverButton}
          </button>
        </form>
      </div>
    </PageShell>
  );
}
