# ADR 0018: Senha opcional para quem não entra pelo Google

- **Status:** Proposto, para revisão do orquestrador.
- **Data:** 2026-11-27
- **Refs:** issue #242; ADR 0009 §5 (relay de e-mail e cota); ADR 0008 §1 (lista de autorizados).

## Contexto

Cada login por link gasta um e-mail da cota do relay. Quem não usa o Google pode, depois do
primeiro acesso, definir uma senha e entrar com ela, sem e-mail. O link continua existindo, como
alternativa e para recuperar a senha. O Auth é o GoTrue v2.198 auto-hospedado.

## Decisão

1. **Senha só é definida por quem já está logado** (`updateUser`). O app nunca chama o cadastro com
   senha (`/auth/v1/signup`). `GOTRUE_DISABLE_SIGNUP` já é `true` hoje; o 404 do Kong nessa rota
   (amarrado ao próprio `request-termination`, para todas as origens) é defesa em profundidade para
   o dia em que o cadastro abrir: aberto, qualquer um criaria conta não confirmada com o e-mail de
   outra pessoa e senha escolhida (sequestro prévio) e gastaria a cota com e-mails de confirmação. O acesso continua passando por `resolve_access` e pela
   lista de autorizados (`requireUser`) depois de **qualquer** login, inclusive o de senha.
2. **Política:** mínimo de 12 e máximo de 72 bytes (limite do bcrypt), sem exigir símbolos
   (`GOTRUE_PASSWORD_MIN_LENGTH=12`). Senha vazada: `GOTRUE_PASSWORD_HIBP_ENABLED=true` (consulta
   por k-anonimato à API pública Pwned Passwords, gratuita, sem enviar a senha nem o e-mail; falha
   aberta se a API cair) **mais** uma lista local das mais comuns no app, que vale mesmo com a API
   fora. O app confere a política antes de chamar o Auth, com a mesma regra da tela (medidor).
3. **Tentativas e borda:** o GoTrue **não** limita `/token` (login por senha) por IP, e o Turnstile
   só protege o app: `/auth/v1/token?grant_type=password` é público via Kong. **Solução escolhida:**
   o login por senha só existe pela rede interna. O proxy de borda sempre acrescenta
   `X-Forwarded-For` às chamadas de fora; o servidor do app fala com o Kong direto, sem esse
   cabeçalho. No `deploy/kong.yml`, uma rota com `headers: x-forwarded-for: ["~*.+"]` responde 404 a
   `/token`, `/recover`, `/otp`, `/magiclink`, `/resend`, `/user`, `/reauthenticate` e `/admin` vindos de fora
   (inclusive `//auth/v1/token` e `%74oken`). O navegador só usa `/verify`, `/authorize` e
   `/callback`, que seguem abertos. Escolhi isso ao `rate-limiting` do Kong porque elimina o vetor
   em vez de só limitá-lo, e não tem estado nem dependência. Medido com o Kong 3.9.4 da imagem do
   compose em `deploy/kong.test.sh` (roda no CI): de fora 404, interno passa. Limite: quem alcança o
   Kong pela rede Docker compartilhada, sem passar pelo proxy, não tem o cabeçalho (risco já
   registrado em `deploy/kong.yml`; a RLS continua a barreira real) e o Turnstile segue como freio
   do app. **Depende de o proxy do servidor sempre pôr `X-Forwarded-For`** (Oracle confere ao aplicar).
   Senha errada, e-mail inexistente e e-mail não confirmado mostram a **mesma** mensagem; a
   recuperação responde sempre com a mensagem neutra do link. **Enumeração por 429:** o limite de
   e-mails (`over_email_send_rate_limit`) é global e por endereço (`SMTP_MAX_FREQUENCY`); quem
   alcançasse `/recover` ou `/otp` direto poderia distinguir endereços pelo 429, mas esses
   caminhos agora respondem 404 de fora, e no app o 429 vira a mesma mensagem neutra.
4. **Telas:** `/entrar` ganha o campo de senha ao lado do e-mail e os botões "Entrar com senha",
   "Receber link por e-mail" e "Esqueci a senha". A página `/senha` (opcional no perfil e em "Meus
   dados") cria, troca e remove a senha, só para quem não tem o provedor Google. Nada de senha em
   log, URL, analytics ou cookie além do cookie de sessão do Auth.
5. **Reautenticação:** `GOTRUE_SECURITY_UPDATE_PASSWORD_REQUIRE_REAUTHENTICATION=true` (sessão com
   mais de 24 h precisa de código por e-mail; custa 1 e-mail, só nesse caso raro) e
   `GOTRUE_SECURITY_UPDATE_PASSWORD_REQUIRE_CURRENT_PASSWORD=true` (quem já tem senha informa a
   atual, sem e-mail; a sessão de recuperação dispensa). Nesta versão, sessão com mais de 24 h
   mostra "saia e entre de novo", como a exclusão de conta, sem tela de código.
6. **Outras sessões:** trocar, remover ou concluir a recuperação da senha encerra as outras sessões
   (`signOut({ scope: "others" })`); falha ao encerrar só vai para o log.
7. **Google não define senha:** além da checagem no app, `/auth/v1/user` (PUT) vem fechado de fora,
   então uma conta Google não consegue definir senha chamando o Auth direto com o próprio JWT. Só o
   app define, e ele recusa conta com o provedor Google.
8. **Recuperação e os portões:** o link termina em `/senha`. Só quem passou pelo termo e pela casa
   cria senha (o perfil exige as duas), então a recuperação não cai nesses portões; lista de espera
   e bloqueio valem e são finais.
9. **Remover a senha** troca por uma senha aleatória de 32 bytes que ninguém vê: o GoTrue não
   tem remoção. A conta continua entrando por link ou Google.
10. **Dado pessoal:** nenhum campo novo (R4). A senha vive só no Auth, em hash.

## Como é garantido

- `tests/senha-gotrue.test.ts` e uma trava no `ci.yml`, ancorada em `^[[:space:]]*CHAVE:`, conferem as
  chaves do compose e amarram cada rota bloqueada ao `request-termination` 404 do seu serviço;
  `deploy/kong.test.sh` mede o comportamento no Kong de verdade.
- Testes de unidade da política e dos fluxos; E2E com banco e Mailpit.

## Fora desta versão

Tela de código para sessão com mais de 24 h; limite por IP na borda para o que sobra aberto (#86); aplicação
no staging (Oracle, depois do merge, com medição de e-mails e do HIBP).
