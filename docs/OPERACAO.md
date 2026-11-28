# Operação do Supabase auto-hospedado

Vale para cada ambiente (staging e produção). Os comandos rodam no diretório
de deploy do ambiente, onde ficam a cópia do compose e o arquivo de segredos.
Endereços, usuários e caminhos do servidor **não** entram neste repositório:
quem opera tem o runbook privado.

## Antes da primeira subida

```bash
./gen-secrets.sh <arquivo-de-segredos> https://<endereco-do-ambiente> <nome-do-ambiente>
```

Gera `JWT_SECRET`, `ANON_KEY`, `SERVICE_ROLE_KEY`, as **três senhas do banco**
(abaixo) e as duas chaves do ADR 0003, com modo 0600. Não imprime valor nenhum
— só nome e tamanho. **Cada ambiente tem as suas chaves** (ADR 0009 §2).

> Perder `FIELD_ENCRYPTION_KEY` torna ilegível todo dado pessoal já cifrado.
> Guarde cópia offline em cofre de senhas. O script se recusa a sobrescrever
> um arquivo existente sem `--force`.

## Senhas por papel do Postgres

Uma senha por papel, nunca uma para todos (issue #95). Quem recebe cada uma:

| Variável | Papel no banco | Quem a recebe |
|---|---|---|
| `POSTGRES_PASSWORD` | `supabase_admin` (superusuário) | só o container `db` e o job de migrations (#81) |
| `AUTHENTICATOR_PASSWORD` | `authenticator` | só o `rest` (PostgREST) |
| `AUTH_ADMIN_PASSWORD` | `supabase_auth_admin` | só o `auth` (GoTrue) |

O motivo é conter o estrago: `rest` e `auth` são os serviços mais expostos, e
com senha compartilhada vazar o ambiente de um deles entregava o superusuário
do banco. O papel `postgres` existe (as migrations do GoTrue fazem `grant … to
postgres`), mas **deve ser NOLOGIN**: ninguém se conecta com ele.

> **Atenção:** o `02-roles.sh` só roda no **primeiro start de um volume vazio**. Um volume criado
> antes da #95 continua com o `postgres` com login e senha. Confira sempre no banco real, com o
> `--conferir` abaixo, e não neste documento.

O `02-roles.sh` aplica as senhas **na criação do volume**. Num volume que já existe, quem confere,
aplica e rotaciona é o `deploy/senhas-papeis.sh` (fora da imagem; copiar para `/opt/complexo42/` como os
outros scripts de operador). Nenhuma senha vai para argumento de processo nem para a tela.

```bash
export COMPOSE_FILE=<dir do deploy>/docker-compose.supabase.yml ENV_FILE=<dir do deploy>/secrets/env \
       SUPABASE_PROJETO=<projeto Compose do Supabase>
sudo -E /opt/complexo42/senhas-papeis.sh --conferir     # só lê: "ok" ou "FALHA" por item, sai 1 se falhar
sudo -E /opt/complexo42/senhas-papeis.sh --aplicar      # se o --conferir acusar: aplica, reinicia rest e auth, confere
```

O `--conferir` olha: as três senhas distintas no arquivo; `postgres` sem login e sem senha;
`authenticator` e `supabase_auth_admin` entrando por TCP com a própria senha e **não** com a do
superusuário; e o ambiente dos containers `rest` e `auth` sem a senha do superusuário.

**Rotação** (vazou, ou troca periódica):

```bash
sudo -E SAUDE_CMD="curl -fsS https://<domínio>/api/healthz" \
  /opt/complexo42/senhas-papeis.sh --rotacionar AUTHENTICATOR_PASSWORD   # ou AUTH_ADMIN_PASSWORD
```

Gera a senha nova, reescreve **só aquela linha** do `secrets/env` (backup ao lado, conferência do
arquivo inteiro antes e depois), aplica no banco, recria **só** o serviço dela (`rest` ou `auth`) e
espera o serviço, o login novo e o `SAUDE_CMD`. Se a saúde não voltar em 2 min, devolve o arquivo **e** a
senha antiga no banco, recria de novo e sai 1. No fim, a senha antiga não entra mais e o backup é apagado.

**A do superusuário (`POSTGRES_PASSWORD`) é manual**, com janela: ela está no ambiente do container
`db` (healthcheck) e do `studio`/`meta`, e trocá-la recria o banco. Passos: `ALTER ROLE supabase_admin
WITH PASSWORD` por `psql` com a senha no stdin (`\set`), trocar a linha no `secrets/env`, `up -d db`
fora do horário de uso e conferir o `--conferir` e o `/api/healthz`.

### Passos do Oracle (#95, nada aplicado ainda)

1. Staging: instalar o script e rodar o `--conferir`. Se acusar `postgres` com login (volume de antes
   da #95), rodar o `--aplicar` e o `--conferir` de novo.
2. Produção, antes de abrir: o mesmo `--conferir`, que tem de passar sem o `--aplicar` (o volume de
   produção nasce com o `02-roles.sh` atual).
3. A demo não entra nisto.

## Estrutura da instância e casas (ADR 0011)

O `supabase/seed.sql` **não roda no servidor** (só no `supabase db reset`/`start`) e o `migra.sh` não
aplica seed. O que é **fixo** da instância vai por **migration**, que entra sozinha no deploy, sem script
instalado (`..._estrutura_instancia.sql`, idempotente, sem sobrescrever o que o operador mudou):

- tipos de unidade (`unit_types`) e a **unidade raiz** nacional (só se ainda não houver raiz);
- as **casas** de `config/instance.ts` (`houses[].id`; sem a linha, `accept_house` recusa a casa
  "casa indisponível"). `tests/house-units.test.ts` garante que a migration tem exatamente as casas da
  config. Casa nova na config = migration nova;
- o catálogo **provisório** de habilidades (47, até o stakeholder aprovar; trocar = migration nova).

- os **27 estados** (UF, slug em minúsculas e nome fixos, filhos da raiz; #365), com o vínculo de quem já estava ativo
  sem estado (`app.attach_active_members_to_state()`, que grava a contagem em `audit_log`). **Sem a unidade do estado
  ninguém ganha vínculo e a coordenação não lê o nome de outra pessoa** (`can_view_profile` exige um vínculo aberto
  no escopo de quem lê): a lista de resultados mostrava "sem nome" para todos, menos para a própria coordenação.

Sem isso o banco fica sem raiz e o bootstrap da primeira coordenação recusa ("a instância não tem
unidade raiz"). A árvore **abaixo dos estados** (regiões e equipes) depende da instalação: no ambiente local vem do
seed; no servidor, o operador a cria (`insert` em `public.units`; o trigger calcula o `path`).

Trocar a **chave** de uma casa (como em 2026-11, de `casa-exemplo-N` para os ids reais) é por
migration (`app.rename_house_key`): ela leva junto vínculos, papéis, resultados e o log de auditoria
sem apagar nada. Casa que **saiu** da config não é apagada (tem vínculos e histórico): desative-a, e ela deixa de
aceitar entradas e coordenadores novos (quem já está nela continua):

```bash
docker compose -f docker-compose.supabase.yml --env-file <segredos> \
  exec -T db psql -v ON_ERROR_STOP=1 -U supabase_admin -d postgres \
  -c "update public.houses set active = false where key = '<id-da-casa>'"
```

## Primeira coordenação (banco novo, #295)

Pré-requisito: a estrutura da instância (seção anterior; vem das migrations, com a raiz). Num banco novo ninguém pode autorizar ninguém: a lista e o papel de gestor da raiz só mudam pela
mão de um gestor da raiz. Quem abre esse ciclo é o **operador**, com `deploy/bootstrap-coordenacao.sh`
(função `app.bootstrap_root_manager`, sem grant para a API). Como o `migra.sh`, é **script de operador, instalado à mão como root** (ver a tabela de
instalação, abaixo) e **fora da imagem** do app; o `email-hmac.mjs` fica ao lado dele e vai ao container
do app por `node -e` para calcular o HMAC com a `BLIND_INDEX_KEY` dele (a chave não sai do app).

Com o cadastro fechado (`GOTRUE_DISABLE_SIGNUP=true`, no compose), quem **não tem conta** no Auth não
entra: nenhum link sai, e a tela de login avisa, para todos, que só entra quem já recebeu acesso. Por isso
a receita começa criando a conta, com `deploy/criar-conta.sh` (#332): ele chama a API de admin do Auth
**de dentro** do container do app, pela rede interna (de fora, `/auth/v1/admin` dá 404, #278), com a
`SERVICE_ROLE_KEY` lida do arquivo de segredos e passada **só por stdin**. A conta nasce confirmada e
**sem acesso**: quem libera é o bootstrap.

```bash
# uma vez, e a cada mudança dos arquivos: cópia à mão, como root
sudo install -m 0755 deploy/criar-conta.sh /opt/complexo42/criar-conta.sh
sudo install -m 0755 deploy/bootstrap-coordenacao.sh /opt/complexo42/bootstrap-coordenacao.sh
sudo install -m 0644 deploy/email-hmac.mjs /opt/complexo42/email-hmac.mjs
# nos dois, o e-mail entra por stdin (digite e Enter); nunca por argumento
sudo APP_CONTAINER=<container-do-app> /opt/complexo42/criar-conta.sh <dir do deploy>/secrets/env
sudo APP_CONTAINER=<container-do-app> DB_CONTAINER=<container-do-banco> \
  /opt/complexo42/bootstrap-coordenacao.sh
```

- `criar-conta.sh` é **idempotente** (conta que já existe não é erro). Saídas: `0` criada ou já existia,
  `1` o Auth recusou, `2` uso errado (e-mail inválido, chave ausente ou que não é a de serviço).
- A pessoa **ainda não entrou**: o e-mail vai para a lista e o comando diz para ela entrar; depois de
  ela entrar uma vez (login e perfil), rode **de novo**. Quem já estava na espera (`waitlisted`) é
  liberado na hora, como na importação, e ganha o papel.
- É **idempotente** (repetir não duplica lista, papel nem auditoria) e **recusa** se a raiz já tem gestor
  ativo. Para acrescentar outro: `--adicionar-outro` (acrescenta, nunca substitui).
- O papel nasce com `granted_by` nulo e só **vale** depois de termo, perfil completo e casa aceita
  (`app.is_active_member`): a pessoa segue pelo termo, questionário e casa no próximo acesso.
- **Conferência** (no container do banco; nada de e-mail aparece):
  `select role, revoked_at, granted_by from public.role_assignments where role = 'manager'`
  deve trazer uma linha com `revoked_at` e `granted_by` nulos, e `select event, reason from public.audit_log
  where event in ('allowlist_imported','role_granted') order by id desc limit 5` mostra o rastro.
- Saídas: `0` ok, `1` falha (nada concedido), `2` uso errado, `3` perfil bloqueado ou suspenso, ou na espera
  sem registro deste e-mail na fila (a mensagem diz qual dos dois).
- E-mails com caracteres não ASCII (acentos, IDN) são **recusados** pelo script (saída `2`).

## Questionário das casas (ADR 0014)

O app pontua o questionário e assina o resultado; o banco só aceita resultado assinado. A chave
`QUESTIONNAIRE_SIGNING_KEY` (gerada por `deploy/gen-secrets.sh`) precisa estar **igual** no
ambiente do app e em `app.server_secrets` (a tabela não tem grant: só funções do banco leem). O banco
também precisa conhecer a `consentTermVersion` do JSON instalado. As duas coisas entram por
`deploy/questionario-banco.sh` (script de operador, instalado à mão como root; tabela abaixo), na
primeira subida, a cada JSON novo e ao trocar a chave. Ele lê a versão do próprio JSON e a chave do
arquivo de segredos, manda tudo ao psql por stdin, numa transação, e não imprime a chave:

```bash
# uma vez, e a cada mudança do script: cópia à mão, como root
sudo install -m 0755 deploy/questionario-banco.sh /opt/complexo42/questionario-banco.sh
sudo DB_CONTAINER=<container-do-banco> \
  /opt/complexo42/questionario-banco.sh <dir do deploy>/questionario/questionnaire.json <dir do deploy>/secrets/env
```

Sem a chave no banco, curta (menos de 32 caracteres) ou diferente da do app, gravar o resultado do
questionário falha (fechado).

- **Janela de relógio:** o banco recusa assinatura emitida há mais de 5 minutos (ou mais de 30
  segundos no futuro). Mantenha os relógios do app e do banco sincronizados (NTP).
- **Rotação da chave:** gere outra, **instale no banco e no app juntos** (o `questionario-banco.sh` e o
  `.env` do app, depois reinicie o app). Entre uma troca e a outra, o questionário falha fechado
  por alguns minutos; nada é perdido (a pessoa tenta de novo).
- **O `pg_dump` e o backup contêm a chave** (`app.server_secrets`). Vale a cifra e a retenção do
  backup (#84); quem restaura um backup antigo restaura a chave antiga: confira se ainda é a do
  app e, se a chave vazou, rotacione.
- **Purga das respostas vencidas (30 dias):** além da purga que acontece a cada uso das funções
  do pedido, agende uma chamada **diária** no cron do operador, para apagar as respostas de
  quem nunca mais voltou:

```bash
docker compose -f docker-compose.supabase.yml --env-file <segredos> \
  exec -T db psql -v ON_ERROR_STOP=1 -U supabase_admin -d postgres -c "select app.purge_expired_analysis()"
```

**Checklist de deploy do questionário (a cada JSON novo).** Sem a versão do termo no banco, **o aceite
do termo falha fechado** (o banco recusa a versão desconhecida, e ninguém consegue responder). Foi o
que aconteceu no staging em 2026-11-28; o job "Staging de mentira" do CI roda este passo pelo script.

**Config com `expectation` (#240).** O `questionnaire.json` do servidor precisa trazer `expectation: {a, b}` em todos os itens dos eixos da casa; sem isso o app **não sobe** (erro `questionnaire_invalid` citando `items.<id>.expectation`). Instale o arquivo novo antes de subir o app novo.

1. **rodar o `questionario-banco.sh`** com o arquivo novo (acima): cadastra a `consentTermVersion`;
2. **instalar o JSON** em `<dir do deploy>/questionario/questionnaire.json`, legível pelo uid 1000 do
   container (`chown 1000:1000` e `chmod 600`); a pasta `./questionario` é montada só leitura em
   `/app/questionario`;
3. **`QUESTIONNAIRE_PATH=/app/questionario/questionnaire.json` no `secrets/env` ANTES de subir o compose**:
   o compose usa `:?` e recusa subir sem ela (e o app, em produção, também);
4. reiniciar o app (ele valida o arquivo na subida e recusa subir com um inválido).

> **Se `./questionario` não existir**, o Docker cria uma pasta **vazia, de root**, e o app falha na
> subida com `questionnaire_invalid` (arquivo ilegível). Crie a pasta e instale o arquivo antes do `up`.

**Trocar a versão do termo geral (`config/consent.ts` + `app.current_consent_version()`).** Quem não aceitou a
versão vigente deixa de valer como membro (`app.is_active_member()` exige o aceite): perde o acesso a dados de
outras pessoas, unidades, coordenação e delegação até aceitar de novo em `/termo`. Nada é apagado. **Comunique a
troca antes** e, antes de publicar, conte quem ficaria sem aceite:
`select count(*) from public.profiles p where not exists (select 1 from public.consent_acceptances c where c.user_id = p.id and c.version = '<versao nova>')`.

**O totem, as notas dos eixos e as respostas do questionário ficam cifrados no banco** (`totem_enc`, `scores_enc`, `answers_enc`,
AES-256-GCM, ADR 0003 e ADR 0014 §5): o Postgres nunca recebe nem devolve esses valores em claro,
então o log do Postgres e o `pg_stat_statements` não os expõem. Verificações:
- `FIELD_ENCRYPTION_KEY` é a mesma do app que grava e lê (perdê-la perde totem, notas e respostas, como
  o nome e o contato). A **rotação** de chaves (ADR 0003 §5) recifra também `totem_enc`,
  `scores_enc` e `answers_enc`.
- O backup (#84) é cifrado e contém essas tabelas (já cifradas): vale a mesma retenção dos demais dados.
- **Delegação:** quem concede, revoga e o que cada gestor vê: `questionnaire_data_grants` e os
  eventos `questionnaire_access_granted/revoked` no `audit_log` (leitura só da coordenação nacional).

## Subir, parar, ver

```bash
docker compose -f docker-compose.supabase.yml --env-file <segredos> up -d
docker compose -f docker-compose.supabase.yml ps
docker compose -f docker-compose.supabase.yml logs -f --tail 50 auth
docker compose -f docker-compose.supabase.yml down          # mantém o volume
docker stats --no-stream                                     # consumo de RAM
```

O volume do Postgres é nomeado: `down` e `up` não perdem dados. Apagar o
volume é explícito (`down -v`) e **apaga o banco**.

## Studio (painel), por túnel SSH

O Studio nunca é publicado. Ele sobe sob demanda, no perfil `admin`, e é
acessado por túnel:

```bash
docker compose -f docker-compose.supabase.yml --env-file <segredos> \
  --profile admin up -d studio meta
# na sua máquina, com o túnel aberto pelo operador:
#   http://localhost:3000
docker compose -f docker-compose.supabase.yml --profile admin down
```

Desligue o Studio ao terminar: ele é o serviço mais pesado do conjunto.

## E-mail

A porta 25 é bloqueada no servidor, então o GoTrue só envia por relay SMTP
externo. Enquanto o cadastro estiver fechado (`GOTRUE_DISABLE_SIGNUP=true`,
até #87 e #26), as variáveis `SMTP_*` ficam vazias e nenhum e-mail sai.

**O link do e-mail sai dos `MAILER_URLPATHS_*`, não do `API_EXTERNAL_URL`.**
O GoTrue monta o link com `API_EXTERNAL_URL.ResolveReference(path)`, onde
`path` é o `MAILER_URLPATHS_*` do fluxo. O default é `/verify`, um caminho
**absoluto** — e `ResolveReference` com referência absoluta **descarta o
caminho da base**. Então `{site}/auth/v1` + `/verify` dá `{site}/verify`, que
cai no app em vez do Auth: o middleware trata como página protegida,
redireciona para o login **levando o token na query string**, e o token nunca é
consumido.

Por isso o compose define os **quatro** caminhos como `/auth/v1/verify`. São
quatro porque o magic link reusa o de **recovery**, não o de confirmation —
deixar um de fora quebra um fluxo só, em silêncio.

O `API_EXTERNAL_URL` com `/auth/v1` serve a outras três coisas, e **nenhuma
delas é o Google**. Na v2.198.0 a chave é lida em exatamente três pontos: a
base do e-mail (`middleware.go:385`, onde o `/auth/v1` é irrelevante porque os
`MAILER_URLPATHS_*` são absolutos), os metadados SAML (`saml.go:60`,
desligado), e o callback de OAuth **customizado** (`external.go:711`, prefixo
`custom:`), que é concatenação de string — com a raiz do site sairia
`{site}/callback`, fora do que o proxy roteia.

> **Provedor embutido não usa essa base.** Google, GitHub e companhia exigem o
> próprio `GOTRUE_EXTERNAL_<PROVEDOR>_REDIRECT_URI`, e ele é **obrigatório**: o
> GoTrue recusa a configuração com `missing redirect URI` se o provedor estiver
> ligado e a chave vazia. Para este ambiente, o valor a cadastrar no provedor e
> na chave é `<SITE_URL>/auth/v1/callback`.

Nada disso aparece em teste: o link só é montado com o GoTrue de verdade
enviando e-mail. Então o CI trava as cinco linhas.

> **Barra final no `SITE_URL` envenena as duas coisas.** Com
> `https://site/`, o callback sai `https://site//auth/v1/callback` e o
> `URI_ALLOW_LIST` sai `https://site//**`. O `gen-secrets.sh` normaliza, mas
> configuração escrita à mão no servidor não passa por ele — conferir.

### E-mails em português (templates do GoTrue)

O e-mail de login sai em português porque o GoTrue busca cada template **no app**, pela rede interna
(`${APP_INTERNAL_URL}`, padrão `http://app:3000`, o alias do app na rede `interna`), nas rotas públicas e
estáticas `/emails/<nome>` (`magic-link`, `confirmation`, `recovery`, `invite`, `email-change`; sem sessão, sem
dado pessoal). O compose define os cinco `GOTRUE_MAILER_TEMPLATES_*` e os cinco `GOTRUE_MAILER_SUBJECTS_*` (os
assuntos são os de `config/instance.ts`). O texto e o nome do app vêm da config da instância.

**Falha silenciosa:** se a URL de um template não responde (app fora do ar, alias errado, rota que passou a
exigir sessão), o GoTrue **cai no template padrão em inglês** e o login continua funcionando: ninguém percebe. Três
travas: (1) o teste `tests/gotrue-email-templates.test.ts` e o passo de CI "define templates e assuntos" exigem as
dez chaves, ancoradas; (2) o teste da rota confere o 200 e o conteúdo; (3) **no teste de fumaça do login, compare
o ASSUNTO do e-mail recebido com o configurado** (por exemplo "Seu link de entrada" para o link de entrada): assunto
em inglês (ou o padrão do GoTrue) significa que o template não foi buscado. Depois de mudar o compose, recrie só o
`auth`; mudar o texto de um template só exige redeploy do app (o GoTrue busca de novo, com cache curto).
## Login com Google (#87)

As credenciais vêm do Google Cloud, num cliente OAuth tipo **Web application**, e
moram no `secrets/env` do ambiente — nunca no repositório.

```sh
GOOGLE_ENABLED=true
GOOGLE_CLIENT_ID=<do Google Cloud>
GOOGLE_CLIENT_SECRET=<do Google Cloud>
```

**O redirect a cadastrar no Google é `<SITE_URL>/auth/v1/callback`, sem barra
final** — o Google casa a string inteira. Esse mesmo valor é o que o compose
monta em `GOTRUE_EXTERNAL_GOOGLE_REDIRECT_URI`, a partir do `SITE_URL`. Não
precisa de "Authorized JavaScript origins": o fluxo é server-side.

> **O redirect é obrigatório para provedor embutido.** O `API_EXTERNAL_URL`
> **não** serve a ele — aquela base vale para OAuth `custom:` e SAML. Com
> `GOOGLE_ENABLED=true` e credencial ou redirect vazios, o GoTrue recusa a
> configuração na partida e **o `auth` não sobe**. Falha fechada e imediata, que
> é o jeito certo de errar isso.

O `GOTRUE_EXTERNAL_GOOGLE_CLIENT_ID` é **lista** no GoTrue: aceita vários ids
separados por vírgula, para cliente web e mobile no mesmo projeto.

Ligar ou desligar é mexer no `secrets/env` e **recriar o `auth`** — a sincronia
do deploy não recria container (ver "A sincronia da infra").

> **Errar aqui derruba o login inteiro, não só o Google.** Com
> `GOOGLE_ENABLED=true` e `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` ou o
> redirect vazios, o GoTrue **recusa a configuração na partida e o `auth` não
> sobe** — e sem `auth` o **link mágico também para**. Por isso, logo depois de
> recriar:
>
> ```bash
> curl -s -o /dev/null -w '%{http_code}\n' https://<SITE_URL>/auth/v1/health   # espera 200
> ```
>
> Se não vier 200, **reverter na hora** (desligar o `GOOGLE_ENABLED`, recriar o
> `auth`) e só então investigar. Conferir o **container**, nunca o arquivo:
>
> ```bash
> docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' <auth> | grep GOOGLE
> ```

**Quem entra pelo Google é só quem já está na allowlist.** O
`GOTRUE_DISABLE_SIGNUP=true` vale para todos os provedores: uma conta Google que
não tenha linha em `auth.users` é **recusada**, e nenhum usuário é criado. O
Google autentica; ele não autoriza. Quem autoriza continua sendo o convite.

## Sessão longa (~30 dias)

A sessão dura 30 dias renovando sozinha, **sem** alongar o token de acesso:

| Chave | Valor | Por quê |
|---|---|---|
| `GOTRUE_JWT_EXP` | `3600` | token de acesso curto. Subir isso só aumenta a janela de um token vazado — quem mantém a sessão viva é o refresh token |
| `GOTRUE_SECURITY_REFRESH_TOKEN_ROTATION_ENABLED` | `true` | cada refresh invalida o anterior |
| `GOTRUE_SECURITY_REFRESH_TOKEN_REUSE_INTERVAL` | `10` (s) | **não é detalhe**: com rotação e intervalo zero, duas abas renovando ao mesmo tempo derrubam a sessão, porque a segunda apresenta um token já rotacionado e o GoTrue trata como roubo |
| `GOTRUE_SESSIONS_TIMEBOX` | `720h` | teto duro de 30 dias: depois disso, login de novo, com ou sem atividade |

**Duas chaves ficaram de fora de propósito**, e o CI recusa se aparecerem:
`GOTRUE_SESSIONS_INACTIVITY_TIMEOUT` faria "30 dias renovando sozinha" deixar de
valer para quem usa esporadicamente, que é o usuário típico aqui;
`GOTRUE_SESSIONS_SINGLE_PER_USER` derrubaria o celular ao entrar no computador.
Ambas são apertos defensáveis — mas com número escolhido de propósito, em PR
próprio.

**O cookie do app não é o limitante.** O `@supabase/ssr` usa
`maxAge: 400 * 24 * 60 * 60` por padrão (o teto que o Chrome impõe) e
`src/server/auth/client.ts` não sobrescreve. Quem governa a duração é o GoTrue.

> **Os 30 dias não são testáveis em CI**: é prazo de calendário. O que se verifica
> é que o `auth` aceitou o `720h` (se o formato estiver errado o container **não
> sobe**), que o `exp` do JWT é de 1 h, que um refresh devolve token novo **com o
> refresh rotacionado**, e que a linha de `auth.sessions` registra o timebox.

## O que está exposto

Só `/auth/v1/*`, publicado pelo proxy reverso. `/rest/v1` responde 404 de
fora: o app o consome pela rede interna. A barreira real dos dados é a RLS,
não o kong — ver `docs/adr/0009` §1.

E **dentro** do `/auth/v1/*` o navegador só alcança o que precisa: `/verify`,
`/authorize` e `/callback`. O resto (`/token`, `/recover`, `/otp`,
`/magiclink`, `/resend`, `/user`, `/reauthenticate` e `/admin`) responde 404
quando vem de fora — a regra casa pelo `X-Forwarded-For`, que o proxy sempre
acrescenta e a chamada interna do app não tem (ADR 0018 §3).

> **`/admin` entrou depois.** De fora ele respondia **401** — o GoTrue
> exigindo a chave de serviço —, e não 404. A chave sozinha já barrava;
> agora a defesa é o segredo **mais** o 404. Consequência operacional:
> `admin/generate_link` (o atalho para emitir um link de acesso sem PKCE)
> continua valendo **de dentro**, pela rede interna ou por `docker exec`, e
> passa a dar 404 pela URL pública.

## Armadilhas

Erros encontrados ao montar isto, todos corrigidos aqui. Valem para qualquer
serviço novo, não só para o Supabase.

**Dois ambientes no mesmo host colidem calados.** Nomes de container e de
volume derivam do nome do projeto Compose. Com `name:` fixo no YAML, staging
e produção viram **o mesmo** projeto: mesmo banco, mesmos containers, e o
segundo `up` sequestra o primeiro. Por isso o nome vem de
`COMPOSE_PROJECT_NAME`, por ambiente.

**Nome de serviço é único dentro do compose, não na rede compartilhada.** A
rede do proxy é compartilhada por todos os projetos do servidor. Dois
ambientes com um serviço `kong` cada dariam, ambos, o alias `kong` nela — e o
proxy entregaria tráfego de staging na produção, de forma intermitente e sem
erro visível. Daí o `KONG_ALIAS` por ambiente, que é o destino que o proxy
usa. Nunca apontar o proxy para o nome do serviço.

**`tr -dc … | head -c N` aborta o script com `set -o pipefail`.** O `head`
fecha o pipe ao atingir N bytes, o `tr` morre com SIGPIPE e a substituição
devolve status diferente de zero. Pior: a **primeira** chamada costuma
passar, então o bug parece intermitente. Para gerar segredo alfanumérico,
`python3 -c "import secrets, string; …"`, sem pipe.

**Senha compartilhada entre papéis vira escalada de privilégio.** No primeiro
desenho, `postgres`, `authenticator` e `supabase_auth_admin` dividiam a
`POSTGRES_PASSWORD` — que é a senha do superusuário. Ela ficava no ambiente do
PostgREST e do GoTrue, os dois serviços que o mundo alcança. Nada quebrava, e
era exatamente esse o problema: só a revisão pega. Hoje são três senhas, e o
teste do `gen-secrets.test.sh` falha se o compose entregar a do superusuário ao
`rest` ou ao `auth`.

**Valor de exemplo não tem cara de chave.** `env.example` usa
`gerado-por-gen-secrets` e descreve o formato em comentário. Base64 ou JWT
de mentira ali fazem gitleaks e GitGuardian acusarem vazamento — e a
correção certa é tirar a entropia do arquivo, nunca silenciar o scanner.

## App (imagem Docker e `/api/healthz`)

A imagem sai do `Dockerfile` da raiz (#80): várias etapas, saída `standalone`,
usuário `node` (uid 1000), sem npm e sem nenhum `.env` dentro. Para construir
e verificar localmente:

```bash
docker build --build-arg GIT_SHA=<commit> --build-arg APP_VERSION=vAAAA.MM.DD -t complexo42 .
./scripts/check-image.sh complexo42   # sem .env, não-root, < 250 MB, healthz 200/503
```

O `GIT_SHA` também vira o `deploymentId` do Next no build (#315): com ele, a página de um build antigo
recarrega em vez de falar com o app novo. Sem o argumento (dev, testes) fica desligado. A Server Action
que já estava em voo durante a troca ainda falha; a tela mostra "recarregue a página" e não trava.

Configuração só por variável de ambiente, validada com Zod na subida
(`src/server/env.ts`). Variável inválida, ou faltando em produção, derruba o
processo com o **nome** da variável no log, nunca o valor.

| Variável | Para quê |
|---|---|
| `DB_HEALTH_URL` | obrigatória em produção; no servidor, `http://rest:3001/ready` (admin do PostgREST) |
| `HEALTH_TIMEOUT_MS` | tempo máximo de **cada** sonda do healthz (padrão 2000; as duas correm em paralelo) |
| `LOG_DIR` | onde fica o `app.log` (padrão `data/logs`) |
| `FIELD_ENCRYPTION_KEY` | **obrigatória em produção**; cifra de campo (ADR 0003). Sem ela **ninguém entra**: o app recusa subir. Exigência reposta em 2026-11-28, depois de o compose do servidor repassar a chave |
| `BLIND_INDEX_KEY` | **obrigatória em produção**; índice cego do e-mail. Sem ela **ninguém entra**: o app recusa subir. Exigência reposta junto com a anterior |
| `QUESTIONNAIRE_PATH` | **obrigatória em produção** (#313); caminho, dentro do container, do JSON real do questionário (ex.: `/app/questionario/questionnaire.json`, da pasta `./questionario` montada só leitura). Sem ela o app **recusa subir**: antes servia em silêncio o exemplo fictício, com a chave de exemplo |
| `FIELD_ENCRYPTION_KEY_VERSION`, `FIELD_ENCRYPTION_PREVIOUS_KEYS` | rotação de chave (ADR 0003 §5); vazio é o normal |
| `QUESTIONNAIRE_SIGNING_KEY` | **obrigatória em produção** (#290); assina o resultado do questionário (ADR 0014). Sem ela o resultado não grava, e o app **recusa subir**. No staging desde 2026-11-28 (`secrets/env` e `app.server_secrets`, as duas pontas); o `gen-secrets.sh` a gera para todo ambiente novo |

> **As duas primeiras ficaram 9 dias no `secrets/env` sem chegar ao container.**
> O `gen-secrets.sh` as gerava, o `env.example` as documentava, e o
> `environment:` do `docker-compose.app.yml` não as listava. O container subia
> saudável, o `/api/healthz` respondia `200` e **todo login era recusado** com
> `auth_access_check_failed reason=missing_key`. Por isso elas agora são
> obrigatórias na subida — app que não autentica ninguém não é app meio
> funcionando — e por isso existe a guarda
> `scripts/check-env-compose.py` no CI, que confere o par
> (obrigatórias no `env.ts`) × (`environment:` do compose do app) em **três
> estados**: obrigatória ausente → erro; obrigatória repassada com `:-`
> (tolerando vazio) → erro, porque a falha só mudaria de lugar; `:?` numa
> chave fora da lista → **aviso**, porque é obrigatoriedade declarada só no
> compose, invisível para quem lê o `env.ts` — e há caso legítimo
> (`SUPABASE_PUBLIC_URL` recebe `${SITE_URL:?}`).
>
> E o deploy ganhou um **preflight** antes das migrations: `compose config -q`
> resolve o compose do app com o env do ambiente, então variável ausente falha
> citando o nome dela, na etapa 2/5. Antes isso só aparecia no `up` da 4/5 —
> **depois das migrations aplicadas** —, e ali o rollback tentava subir a
> imagem anterior com o mesmo env quebrado, falhava também e registrava
> `rollback_falhou`: o log acusava o rollback quando o problema era uma linha
> de configuração.
>
> **E um segundo preflight, na mesma etapa 2/5: as obrigatórias CHEGAM ao
> container?** `config -q` responde "o compose resolve" — não responde "o app
> recebe o que exige". Variável que o compose do **servidor** simplesmente não
> lista não aparece em erro nenhum: o app sobe saudável e falha no uso. Foi o
> login do staging em 2026-11-28, com as chaves no `secrets/env`, o healthz
> verde e `reason=missing_key` em toda entrada. O deploy agora lê
> `deploy/obrigatorias-em-producao.txt` **da imagem que está implantando** e
> confere, no compose resolvido, que cada nome chega com valor não vazio.
> Falta alguma, ele para antes das migrations e **diz o nome** — nunca o valor.
>
> A lista vem da imagem, não do servidor, porque a exigência é **daquela
> versão do app**: cópia no servidor envelheceria em silêncio, e sincronizá-la
> faria o deploy ler o que a sincronia escreve. No break-glass (imagem por
> tag, possivelmente antiga) a ausência da lista só **avisa**: ali recusar
> custaria o restabelecimento do serviço. O CI mantém a lista igual ao
> `REQUIRED_IN_PRODUCTION` do `env.ts` (`scripts/check-env-compose.py`), para
> as duas não divergirem em silêncio.
>
> **O `QUESTIONNAIRE_SIGNING_KEY` foi gerado e instalado no `secrets/env` do
> staging em 2026-11-28**, junto com a mesma chave em `app.server_secrets`
> (ADR 0014 exige as duas pontas), e **entrou nas obrigatórias** (#290) quando a
> produção ainda não existia: o `gen-secrets.sh` a gera para todo ambiente novo,
> então não há ambiente que a exigência derrube. O app recusa subir sem ela, e a
> guarda do deploy (`obrigatorias-em-producao.txt`) confere que o compose do
> servidor a repassa.

`GET /api/healthz` responde `{status, version, db, schema, terms}` com
`Cache-Control: no-store`, e dá **200 só quando as três sondas passam**:

| Campo | Sonda | O que prova |
|---|---|---|
| `db` | `DB_HEALTH_URL` (`rest:3001/ready`) | o processo do PostgREST está de pé |
| `schema` | `SUPABASE_URL` + `/rest/v1/profiles?select=id&limit=1`, com a chave anon | a **API de dados conhece o esquema de hoje** |
| `terms` | `SUPABASE_URL` + `/rest/v1/rpc/term_versions_check`, com a chave anon | o banco **tem as versões do termo da config** (#222): a do termo do questionário em `app.questionnaire_term_versions` e a do termo geral igual a `app.current_consent_version()` |

Qualquer estado diferente de `ok` nas três dá 503 (`degraded`). O motivo da
falha (`timeout`, `network`, `http_error`) vai só para o log.

> **`terms` (#222).** Em 2026-11-28 o staging subiu com a tabela de versões do termo vazia e o
> aceite do termo do questionário era recusado em silêncio (`questionnaire_consent_refused`).
> `public.term_versions_check(versão do questionário, versão do termo geral)` só lê e devolve
> `ok` ou `degraded`, **sem dizer qual das duas falhou**; o corpo do healthz também mostra só `ok`
> ou `degraded`, nunca a versão (o log tem `healthz_terms_missing`). O app não tem chave de
> serviço (R6), então a função é executável por `anon` (o healthz roda sem login); ela valida o
> formato das versões e a tabela segue sem acesso pela API.
>
> **Quem cadastra o quê.** A versão do termo **geral** vem por migration
> (`app.current_consent_version()`). A do termo do **questionário** NÃO vem por migration: o
> operador a cadastra junto com o JSON privado (checklist do questionário, acima), para não levar
> `termo-exemplo-1` à produção. A sonda detecta que o operador **esqueceu esse passo**.
>
> **Esquecer o cadastro faz o deploy voltar a imagem.** `terms: "degraded"` torna o status geral
> `degraded` (503); o smoke do deploy (`curl -f` no `/api/healthz`) falha e o deploy devolve a
> imagem anterior. Por isso o cadastro vem **antes** do deploy do questionário novo. Sem o arquivo
> do questionário legível, `terms` também fica degradado.

> **Por que duas sondas, e não uma.** Elas falham por motivos diferentes, e a
> primeira não vê a falha da segunda. O `/ready` responde **200 com o cache de
> esquema vazio**: em 2026-11-27 o PostgREST subiu antes de o banco terminar
> de migrar, ficou 19 horas com 2 relações de 23 no cache, toda leitura de
> perfil deu 404 — e **o login quebrou depois de autenticar com sucesso**,
> pelo Google e pelo link por e-mail. O healthz seguiu verde o tempo todo, e
> por isso o deploy nunca reverteu. O conserto da causa está no `migra.sh`
> (`notify pgrst, 'reload schema'`); esta sonda é o que faz a falha aparecer
> se acontecer de novo, por outro caminho.
>
> **`schema: "stale"` tem evento próprio no log** (`healthz_schema_stale`, em
> nível de erro), porque o conserto é um comando e não melhora sozinho:
> `notify pgrst, 'reload schema'` no banco do ambiente.
>
> A sonda considera **saudável** a resposta `401` com código `42501`
> (`insufficient_privilege`): ela prova que o PostgREST resolveu a tabela e o
> Postgres recusou o papel `anon` — que é o estado normal, porque `profiles`
> tem grant só para `authenticated`. Depender disso em vez de exigir `200` é
> deliberado: a sonda não precisa de grant nenhum para o `anon`, então não
> abre leitura de dado para ninguém.
>
> **E a tabela sondada é `profiles`, não uma de referência.** O cache é um
> retrato do esquema no instante da carga, e o `migra.sh` aplica uma migration
> por transação: um retrato tirado no meio da sequência pega as tabelas já
> criadas e não as seguintes. `municipalities` (`20261119140000`) vem antes de
> `profiles` (`20261119140100`) — sondar a primeira daria "ok" num cache que
> não conhece a segunda. `profiles` é a última do caminho do login a entrar, e
> foi o `404` dela que derrubou a entrada.

**O health check do deploy não mudou, e não precisava.** O `smoke()` do
`deploy.sh` já bate no `/api/healthz` com `curl -fsS`, repetindo até
`ESPERA_SMOKE` (60 tentativas, 1s cada). Com o healthz ficando estrito, o
deploy passa a reverter sozinho num esquema velho — sem uma linha nova no
script. Os logs são JSON, no stdout e em `data/logs/app.log`, e mascaram nome,
telefone e e-mail (R11). O compose de referência é `deploy/docker-compose.app.yml`:
sistema de arquivos só leitura, sem `ports:`, com `mem_limit`. Use nele um
`COMPOSE_PROJECT_NAME` diferente do Supabase e aponte `SUPABASE_NETWORK` para a
rede `<projeto-do-supabase>_interna`.

**Tamanho do corpo (#86).** As server actions aceitam até 2 MB (`next.config.ts`),
por causa do envio da lista de autorizados (`/coordenacao/autorizados`, até 1,5 MB).
O limite vale para todas as actions, inclusive as sem login: o proxy de borda pode
baixá-lo por rota e deixar os 2 MB só para `/coordenacao/autorizados`.

## Senha opcional (ADR 0018, #242)

Quem não entra pelo Google pode criar uma senha em `/senha` ou no perfil e entrar sem e-mail.
**Passo OBRIGATÓRIO pós-merge do #247, antes de liberar a senha.** O Kong do servidor é DB-less
e só lê o `deploy/kong.yml` na partida, e o deploy NÃO o recria: sem recriar, a regra nova não
vale e o login por senha fica aberto ao público (`/auth/v1/token`). Para aplicar (o agente do
servidor executa e mede):

1. **Recriar o `kong` e o `auth`** (o `auth` pelas variáveis `GOTRUE_PASSWORD_*` e
   `GOTRUE_SECURITY_UPDATE_PASSWORD_*` do compose; o `kong` pelo `kong.yml`):
   `docker compose up -d --force-recreate kong auth` (no compose do Supabase). Esperar os dois
   saudáveis. Conferir o ambiente do `auth` carregado, e não o arquivo:
   `docker compose exec auth env | grep -E 'GOTRUE_(PASSWORD|SECURITY_UPDATE_PASSWORD)'`.
2. **Verificar DE FORA, por medição** (da máquina de quem opera, pelo endereço público; trocar
   `$SITE`). Ler o arquivo não vale: só o curl prova o que o Kong em execução faz.
   ```
   curl -s -o /dev/null -w '%{http_code}\n' -X POST "$SITE/auth/v1/token?grant_type=password"   # 404
   curl -s -o /dev/null -w '%{http_code}\n' -X POST "$SITE/auth/v1/signup"                        # 404
   curl -s -o /dev/null -w '%{http_code}\n' -X POST "$SITE/auth/v1/recover"                       # 404
   curl -s -o /dev/null -w '%{http_code}\n' -X POST "$SITE/auth/v1/otp"                           # 404
   curl -s -o /dev/null -w '%{http_code}\n' "$SITE/auth/v1/verify"                                # NAO 404
   curl -s -o /dev/null -w '%{http_code}\n' "$SITE/auth/v1/authorize?provider=google"             # NAO 404
   ```
   Os quatro primeiros têm de dar **404**; `/verify` e `/authorize` têm de **passar** (qualquer
   código diferente de 404, em geral 400 ou 302). Repetir `//auth/v1/token`, `/auth/v1/%74oken` e
   `//auth/v1/signup`. Se `/token` não der 404, o Kong não foi recriado ou o proxy não põe
   `X-Forwarded-For`: **não liberar a senha** e voltar a este passo.
3. Depois do passo obrigatório: o link por e-mail e o Google continuam entrando (testar um login de cada). O HIBP consulta `api.pwnedpasswords.com` (HTTPS de saída, por k-anonimato). Conferir que o
   `auth` alcança a API; com ela fora, o GoTrue deixa passar e vale só a lista local do app.
4. A recuperação usa o modelo `recovery` servido pelo app (`/emails/recovery`, #238), com
   `{{ .ConfirmationURL }}`: o link passa por `/auth/v1/verify` e volta por `/auth/callback?next=/senha`,
   o que só funciona no mesmo navegador que pediu (PKCE). No local, `supabase/templates/recovery.html`
   leva a `/auth/confirmar` (qualquer navegador). Conferir a recuperação ponta a ponta no staging.
5. O login por senha pelo app deve continuar funcionando depois do passo 2 (o app fala com o Kong
   interno, sem `X-Forwarded-For`; `SUPABASE_URL` do app é o Kong interno, nunca a URL pública).
   Medir também a recuperação sem senha atual no v2.198.
6. Medir por alguns dias: e-mails enviados por login (a cota do relay) e a taxa de "senha errada".
   O GoTrue não limita `/token` por IP: por isso ele só atende o app (item 5).

Voltar atrás: apagar as quatro chaves `GOTRUE_PASSWORD_*` e `GOTRUE_SECURITY_UPDATE_PASSWORD_*`
volta aos padrões do GoTrue; as senhas já criadas continuam valendo.

## Cloudflare Turnstile no login por e-mail (#116)

O formulário "Receber link por e-mail" de `/entrar` tem o widget do Turnstile
(gratuito), no modo *managed*. Sem ele, um robô poderia disparar milhares de
e-mails para terceiros e esgotar a cota de envio, travando o login de todos. O
token do widget é conferido **no servidor** (`src/server/auth/turnstile.ts`),
na server action, antes de pedir o link ao Auth. Token ausente, recusado ou o
siteverify fora do ar (limite de 3 s): o e-mail não sai e a tela mostra a mesma
resposta neutra de sempre. O log leva só o código (`auth_turnstile_failed`,
`reason`), nunca o token, o IP ou o e-mail. O botão do Google não tem widget.

**Criar o widget (uma vez por ambiente).** No painel da Cloudflare, em
*Turnstile* → *Add widget*: um nome que identifique o ambiente, os hostnames
do ambiente (o de produção num widget e o de staging em outro; nada de
`localhost` no widget de produção) e o modo **Managed**. O painel mostra a
*site key* e a *secret key*.

**Onde as chaves entram.** No arquivo de segredos do ambiente, no servidor
(`secrets/env`, modo 0600, o mesmo do `gen-secrets.sh`), em `TURNSTILE_SITE_KEY`
e `TURNSTILE_SECRET_KEY`. O `gen-secrets.sh` deixa as duas vazias e o
`docker-compose.app.yml` recusa subir sem elas; em produção o app também não
sobe sem elas. A site key é lida em tempo de execução e entregue à tela (não é
`NEXT_PUBLIC_*`), então a mesma imagem serve staging e produção. A secret nunca
sai do servidor e nunca entra no repositório (R7). Para trocar a secret, use
*Rotate secret key* no painel e reinicie o app.

**IP do usuário.** O `remoteip` vai ao siteverify só com
`TRUST_CF_CONNECTING_IP=true`, a mesma regra do rate limit do Auth (só quando
apenas a Cloudflare alcança a origem).

**Local, CI e E2E** usam as chaves de teste oficiais da Cloudflare, públicas
(listadas no `.env.example`): sem variável, fora de produção, vale a que sempre
passa. O E2E as define no `playwright.config.ts`.

**CSP (#152).** O proxy (`src/proxy.ts`) põe a CSP em toda página, com um nonce
novo a cada requisição (`src/server/csp.ts`); por isso toda página é montada na
hora (o build lista as rotas como `ƒ`). Ela libera só o Turnstile, em toda
página e não só em `/entrar`: um redirect de server action chega a `/entrar`
sem recarregar, e aí vale a CSP da página anterior.

| Diretiva | Origem |
|---|---|
| `script-src` | `'self'`, o nonce, `'strict-dynamic'` e `https://challenges.cloudflare.com` |
| `frame-src` | `https://challenges.cloudflare.com` |
| `connect-src` | `'self'` (o navegador nunca fala direto com o Supabase) |

A chamada ao siteverify parte do servidor, não do navegador, então não entra
em `connect-src`. Para estrear num ambiente sem risco, ponha
`CSP_REPORT_ONLY=1` no `secrets/env` dele e recrie o app (o
`docker-compose.app.yml` repassa a variável): o navegador só avisa no console o
que bloquearia (`Content-Security-Policy-Report-Only`). Sem avisos depois de usar as telas,
tire a variável e reinicie: com ela ligada, a CSP não bloqueia nada, então não
a deixe em produção. Para conferir: `curl -sI https://<domínio>/entrar` mostra
o cabeçalho, com um nonce diferente a cada chamada.

A única página pronta no build é a de erro geral do Next (`/_global-error`), que
só aparece se o próprio layout raiz quebrar. Sem nonce, ela abre sem os scripts:
o texto aparece, mas o botão de tentar de novo não responde; recarregar resolve.

## Backup cifrado e restauração (#84)

**O par de chaves nasce fora do servidor.** Quem mantém gera na própria máquina:

```bash
age-keygen -o chave-privada.txt      # guarde OFFLINE, nunca no servidor
grep 'public key' chave-privada.txt  # a linha age1... é o que vai no servidor
```

Só a **pública** (`age1...`) entra no arquivo de segredos do ambiente, como
`AGE_RECIPIENT`. A **privada** vai para o cofre offline, com dois mantenedores
(ADR 0003 §7). O servidor cifra e **não consegue decifrar** — é essa assimetria
que faz um backup vazado não virar vazamento de dados.

> Perder a privada é perder todos os backups. Guardar a privada no servidor é
> anular o backup cifrado. Os dois erros são definitivos; o segundo é silencioso.

### Rodar

```bash
COMPOSE_FILE=<compose do ambiente> ENV_FILE=<segredos> \
PROJECT_DIR=<diretório de deploy> BACKUP_DIR=<onde guardar> \
AGE_RECIPIENT=age1... ./deploy/backup.sh
```

O `pg_dump` sai do container por **pipe** e entra direto no `age`: o dump em
claro nunca toca o disco, nem em `/tmp`. O script recusa rodar se faltar
variável, se a chave pública não tiver o formato `age1...`, se o arquivo sair
menor que o mínimo ou se o cabeçalho não for de arquivo `age` — cada uma dessas
checagens existe porque o desastre correspondente é silencioso.

Se o `age` não estiver no host, defina `AGE_IMAGEM` com uma imagem fixada por
digest que o traga; o script usa o container em vez do binário local.

### Retenção

`backups/diario/` guarda 7; `backups/semanal/` guarda 4. O semanal é **link
duro** para o diário de domingo — não gera segundo dump nem ocupa espaço a mais.
Diretórios com modo 700, arquivos 600.

### Restaurar — e testar a restauração

> Backup que nunca foi restaurado não conta.

```bash
INITDB_DIR=<dir do deploy>/initdb REGISTRO=<dir do deploy>/data/logs/backup.log \
  MINIMOS="perfis=<n> unidades=1 casas=<n> papeis=1 municipios=5000" \
  ./deploy/restore-test.sh <arquivo.age> <chave-privada>
```

Sobe um Postgres descartável com a **mesma imagem** e o **mesmo `initdb`** do ambiente (sem os papéis
do `initdb`, o `pg_restore` para na primeira política `to authenticated`), decifra, restaura, mede o
**tempo** e confere as contagens de controle (perfis, unidades, vínculos de unidade e de casa, papéis,
municípios). **Reprova** se alguma vier abaixo do `MINIMOS`: banco restaurado vazio não é restauração
ok. Use mínimos um pouco abaixo dos números de produção. O resultado, o tempo e as contagens (só
números) vão numa linha do `REGISTRO`, e o container é apagado no fim. Não toca o banco do ambiente.

A chave privada entra só durante o teste e sai com quem a trouxe: o script não a copia nem a
imprime. No servidor, apague a cópia temporária ao terminar.

**Quando:** antes do primeiro dado real e **todo mês**, com o backup remoto (`--do-remoto`, abaixo),
pelos mantenedores que guardam a chave. É manual de propósito: automatizar no servidor exigiria a
chave privada lá, e quem cifra não pode decifrar (ADR 0003 §7); mudar isso pede ADR. Quem prova os
**scripts** a cada PR é o job "Staging de mentira" do CI, que faz backup e restauração com um par
`age` descartável e exige que um mínimo impossível reprove.

### Restaurar em produção: reaplicar as exclusões de conta (#18)

Um backup é anterior às exclusões feitas depois dele. Restaurar sem cuidado traria de volta
contas que as pessoas apagaram (LGPD art. 18, VI). Se o banco atual ainda abre, **antes** de
restaurar, guarde os ids:

```sql
select distinct target_id from public.audit_log where event = 'account_deleted';
```

**Restaurar** (app parado, banco num volume novo, que já nasce com o `initdb`): o mesmo comando que o
`restore-test.sh` roda e o CI prova a cada PR, com donos e privilégios. Sem `--clean --if-exists`, o
`pg_restore` para no `create schema auth` que o `initdb` já fez.

```bash
age -d -i <chave-privada> <arquivo.age> \
  | docker compose -f docker-compose.supabase.yml --env-file <segredos> exec -T db \
      pg_restore -U supabase_admin -d postgres --clean --if-exists --exit-on-error
```

Depois de restaurar, como `supabase_admin` (o `postgres` deve ser NOLOGIN; veja "Senhas por papel"), apague cada id da lista
que voltou, numa transação. O `account_deleted` entra **antes** de apagar `auth.users`: o
`audit_log` recusa evento de ator que não existe mais.

```sql
begin;
insert into public.audit_log (actor_id, event, target_id) values ('<id>', 'account_deleted', '<id>');
delete from auth.audit_log_entries
where payload ->> 'actor_id' = '<id>' or payload -> 'traits' ->> 'user_id' = '<id>'
   or payload ->> 'actor_username' = (select email from auth.users where id = '<id>')
   or payload -> 'traits' ->> 'user_email' = (select email from auth.users where id = '<id>');
delete from auth.flow_state where user_id = '<id>';
delete from auth.users where id = '<id>';  -- o resto vai em cascata
commit;
```

Se o banco atual se perdeu, as exclusões feitas depois do último backup se perdem com ele
(no máximo um dia, com o backup diário): avise no canal de incidentes e trate como pedido
pendente de quem tiver reclamado.

### Cópia fora da VPS (Google Drive via rclone)

Backup que mora no mesmo disco do banco não é backup: se a instância sumir, ele
some junto. O `deploy/enviar-backup.sh` copia os `.age` para o Google Drive.

**Por que Drive e não um S3 compatível:** a conta Google gratuita não tem meio
de pagamento, então não existe caminho para cobrança — mesmo princípio da cota
do Oracle (R19). R2 e B2 cobram por uso acima do limite grátis.

O arquivo sai do servidor **já cifrado** e o destino é tratado como não
confiável por desenho: quem obtiver os arquivos no Drive não obtém os dados.

#### 1. Instalar o rclone no servidor

```bash
sudo apt install rclone age    # os dois de uma vez; ver nota abaixo
```

O `rclone` tem de estar no host, não em container: a autorização OAuth é
interativa e o token fica no arquivo de configuração do host. Como o `rclone`
já exige instalação no host, o `age` vai pelo mesmo caminho — e aí o
`AGE_IMAGEM` do `backup.sh` deixa de ser necessário.

#### 2. Autorizar — num servidor sem navegador

O servidor não abre navegador, então a autorização é em duas máquinas.

**No servidor:**

```bash
rclone config
```

Responda: `n` (New remote) · nome do remoto · storage `drive` · `client_id` e
`client_secret` vazios · **scope: a opção descrita como "Access to files
created by rclone only"** (`drive.file`, normalmente a `3`) ·
`service_account_file` vazio · advanced config `n` · **"Use web browser to
automatically authenticate?" → `n`**.

O rclone então imprime uma linha para rodar **na sua máquina**:

```
rclone authorize "drive" "eyJzY29wZSI6ImRyaXZl..."
```

**Na sua máquina** (`brew install rclone` antes), rode exatamente essa linha. O
navegador abre, você escolhe a conta e aprova; o rclone imprime um token entre
chaves. Cole esse token de volta no prompt `config_token>` do servidor.
Depois: Shared Drive `n`, manter o remoto `y`, `q` para sair.

> **Qual conta Google.** Use uma conta **dedicada**, não a sua pessoal. O
> escopo `drive.file` já limita o rclone aos arquivos que ele mesmo criou, mas
> uma conta separada torna o token inútil para qualquer outra coisa — e 15 GB
> grátis sobram para esses dumps.

Confira sem transferir nada:

```bash
rclone lsd <nome-do-remoto>:
```

#### 3. O token no servidor

Fica em `~/.config/rclone/rclone.conf` do usuário que roda o backup. É um
**refresh token**: vale como segredo, modo `600`, e nunca entra neste
repositório nem em imagem Docker.

O que um servidor comprometido consegue: **apagar** o que o rclone criou no
Drive. Não consegue **ler** o conteúdo (está cifrado) nem alcançar o resto da
conta (escopo `drive.file`). Por isso a série local de 7+4 continua existindo —
o Drive é a segunda cópia, não a única.

#### 4. Rodar

```bash
BACKUP_DIR=<onde o backup.sh gravou> RCLONE_REMOTO=<remoto>:<pasta> \
  ./deploy/enviar-backup.sh
```

Envia, **confere** (`rclone check`, de um lado só) e só então poda o destino
para os mesmos 7 diários e 4 semanais. A ordem é a proteção: podar antes de
conferir apagaria a única cópia boa quando o envio falha. A poda ordena pelo
**nome** (que carrega o carimbo UTC), não pela data no destino, que quem
hospeda pode reescrever.

Uma diferença esperada: no servidor o semanal é link duro e não ocupa espaço a
mais; no Drive não existe link duro, então o domingo conta como dois arquivos.

#### 5. Agendar os dois passos

Timer do systemd no **host** — nunca dentro do container, que o deploy recria.
Diário às 03:00 em São Paulo (06:00 UTC), fora do pico.

```ini
# /etc/systemd/system/complexo42-backup.service
[Service]
Type=oneshot
User=<usuário do deploy>
EnvironmentFile=<arquivo com COMPOSE_FILE, ENV_FILE, PROJECT_DIR, BACKUP_DIR,
                 AGE_RECIPIENT e RCLONE_REMOTO>
ExecStart=<dir>/deploy/backup.sh
ExecStart=<dir>/deploy/enviar-backup.sh
```

```ini
# /etc/systemd/system/complexo42-backup.timer
[Timer]
OnCalendar=*-*-* 06:00:00 UTC
Persistent=true
[Install]
WantedBy=timers.target
```

Dois `ExecStart` no mesmo `oneshot` rodam **em sequência, e o segundo só se o
primeiro passar** — é o que queremos: não enviar um backup que falhou.
`Persistent=true` roda o que ficou para trás se a máquina estava desligada.

```bash
sudo systemctl enable --now complexo42-backup.timer
systemctl list-timers complexo42-backup.timer   # confere o próximo disparo
journalctl -u complexo42-backup.service -n 50   # confere a última execução
```

Falha gera alerta pelo vigia (abaixo): ele avisa quando o `.age` mais novo passa de 26 h. Cada script
sai com código ≠ 0 em qualquer erro, para o `journalctl` mostrar a causa.

#### 6. Testar a restauração a partir do Drive

```bash
./deploy/restore-test.sh --do-remoto <chave-privada>
```

**É este o teste que vale.** Restaurar um arquivo local prova que o dump está
bom; só o `--do-remoto` prova que a cópia fora da VPS existe, chegou inteira e
pode ser recuperada — ele baixa o `.age` mais novo do Drive, restaura num
Postgres descartável e apaga o que baixou no fim.


## Vigia e alertas (#85)

Dois olhos, porque o servidor não consegue avisar que caiu:

- **De fora**, o monitor de uptime (passo do Felipe, abaixo) consulta o `/api/healthz` de cada ambiente
  a cada 5 min. Um workflow diário do GitHub (`.github/workflows/vigia-externo.yml`, PR de workflow #367, merge do
  Felipe) confere de novo o healthz e o certificado: é o reforço, e pega também o vigia do servidor ter parado.
- **De dentro**, o `deploy/vigia.sh` roda a cada 5 min e mede: disco ≥ 80% (`/`, a raiz de dados do
  Docker e `data/logs`), memória de cada container ≥ 90% do `mem_limit`, container `unhealthy` ou
  reiniciando, backup mais novo com mais de 26 h e certificado a menos de 15 dias. Não conseguir medir
  (Docker fora) também alerta.

**Sem alerta falso:** só na 2ª medição ruim seguida; um e-mail na transição (ALERTA, RESOLVIDO) e um
LEMBRETE a cada 6 h se o problema continuar. Nunca um e-mail a cada 5 minutos. Tudo vai também para o
registro (`/var/log/complexo42-vigia/<ambiente>.log`) e para o `journalctl`.

O e-mail sai pelo **mesmo relay SMTP do GoTrue** (as `SMTP_*` do ambiente), por `curl`, com a senha em
arquivo temporário em `/run` (nunca em argumento). **Com `ALERTA_PARA` vazio, nada é enviado**: o vigia só
registra. Dá para instalar antes de o remetente existir.

Roda com **usuário próprio**, não como root: o `complexo42-vigia`, no grupo `docker` (para o `docker ps`
e o `docker stats`), lendo um arquivo **só com as `SMTP_*`**, nunca o `secrets/env` inteiro. O estado, o
log e o arquivo temporário da senha ficam nos diretórios que o systemd cria para ele; o da senha em
`/run` (memória), que funciona mesmo com o disco cheio, que é justamente o caso a pegar.

```bash
# uma vez, e a cada mudança do script: cópia à mão, como root
sudo install -m 0755 deploy/vigia.sh /opt/complexo42/vigia.sh
sudo useradd --system --no-create-home --shell /usr/sbin/nologin --groups docker complexo42-vigia
# só as SMTP_* do ambiente, legíveis só pelo vigia
sudo sh -c 'umask 077; grep "^SMTP_" <dir do deploy>/secrets/env > /etc/complexo42/vigia-<ambiente>.smtp'
sudo chown complexo42-vigia: /etc/complexo42/vigia-<ambiente>.smtp
# a pasta dos backups é 700 do root: o vigia só precisa LISTAR (data dos .age), não ler
sudo setfacl -m u:complexo42-vigia:rx <dir dos backups> <dir dos backups>/diario
```

```ini
# /etc/complexo42/vigia-<ambiente>.conf  (root:root, 644: não tem segredo)
AMBIENTE=<ambiente>
ESTADO_DIR=/var/lib/complexo42-vigia/<ambiente>
REGISTRO=/var/log/complexo42-vigia/<ambiente>.log
ENV_FILE=/etc/complexo42/vigia-<ambiente>.smtp
DISCOS=/ /var/lib/docker <dir do deploy>/data/logs
PROJETOS=<projeto do Supabase> <projeto do app>
BACKUP_DIR=<dir dos backups>        # vazio: não confere (staging sem backup)
CERT_HOST=<domínio do ambiente>
ALERTA_DE=                          # o remetente verificado no relay (passo do Felipe)
ALERTA_PARA=                        # vazio: só registra; vários separados por vírgula
```

```ini
# /etc/systemd/system/complexo42-vigia@.service
[Unit]
Description=Vigia do Complexo42 (%i)
[Service]
Type=oneshot
User=complexo42-vigia
Group=complexo42-vigia
SupplementaryGroups=docker
EnvironmentFile=/etc/complexo42/vigia-%i.conf
StateDirectory=complexo42-vigia/%i
LogsDirectory=complexo42-vigia
RuntimeDirectory=complexo42-vigia-%i
ExecStart=/opt/complexo42/vigia.sh

# /etc/systemd/system/complexo42-vigia@.timer
[Unit]
Description=Vigia do Complexo42 a cada 5 min (%i)
[Timer]
OnBootSec=2min
OnUnitActiveSec=5min
[Install]
WantedBy=timers.target
```

```bash
sudo systemctl enable --now complexo42-vigia@<ambiente>.timer
journalctl -u complexo42-vigia@<ambiente> -n 20    # o que ele viu (também com o disco cheio)
```

Com o disco cheio, o vigia **não fica mudo**: sem estado gravável, alerta já na 1ª medição ruim; o log
e o estado falham sem abortar (o estado é gravado por arquivo novo + `mv`, nunca truncado no lugar), e
tudo sai também no `journalctl`. A troca da senha do relay pede regravar o `.smtp`.

**Rotação dos logs** (pedido da revisão do #103): o `app.log` e o `backup.log` crescem sem limite. No host:

```
# /etc/logrotate.d/complexo42-<ambiente>
<dir do deploy>/data/logs/*.log /var/log/complexo42-vigia/*.log {
  weekly
  rotate 8
  compress
  missingok
  notifempty
  copytruncate
}
```

### Passos do Felipe (nada disso está feito)

1. **Monitor de uptime:** criar a conta grátis no UptimeRobot (sem cartão) e dois monitores HTTP, um
   por ambiente, em `https://<ambiente>/api/healthz`, a cada 5 min, alertando os mantenedores por
   e-mail. Anotar o link da página de status **no runbook privado**: ele leva ao endereço do servidor,
   que não entra neste repositório.
2. **Remetente:** verificar no relay SMTP um endereço de alerta do domínio (ex.: `alertas@…`) e pôr em
   `ALERTA_DE`; os destinatários vão em `ALERTA_PARA`.
3. **Vigia externo:** cadastrar o segredo `VIGIA_URLS` no repositório (origens separadas por espaço).
   Sem ele, o workflow diário só avisa que não há nada a conferir.

### Teste (Oracle, no staging)

Derrubar o app (`docker compose … stop app`) e cronometrar: o monitor externo tem de alertar **em até
10 min** (2 falhas seguidas de 5 min). Subir de novo e conferir o aviso de volta. Para o vigia do host,
encher um disco de teste não é preciso: o `deploy/vigia.test.sh` prova a lógica no CI. No servidor, basta
conferir no `journalctl -u complexo42-vigia@<ambiente>` que ele registra as medições e que, com `ALERTA_PARA` preenchido, o e-mail chega.

## Deploy do app (#81)

`deploy/deploy.sh` é a versão de **referência**, usada no staging. A produção
roda a cópia do repositório de infraestrutura (ADR 0009 §3).

**Ele roda como root, por `sudo`, a partir de um forced-command.** Isso define
todo o resto: tudo o que ele executa ou interpreta é conferido antes.

### As três entradas, e por que cada uma é tratada assim

**A referência da imagem** chega por **argumento**, não por
`SSH_ORIGINAL_COMMAND` — essa variável não sobrevive ao `sudo` (`env_reset`).
É validada com `[[ =~ ]]` e **não** com `grep`: o `grep` casa por **linha**,
então `sha-abc\nrm -rf /` passaria por um `^...$` olhando só a primeira linha.
Isso foi medido, não suposto.

**No caminho normal, só digest** (`sha256:<64 hex>`). Tag é ponteiro: aceitá-la
aqui esvaziaria a #161, porque o destino não imporia nada. O `deploy.yml`
resolve tag→digest **no runner** (`buildx imagetools inspect`) antes de
chamar o servidor, inclusive no `workflow_dispatch` manual.

**Break-glass:** `emergencia:<tag>` implanta por tag, e o log registra
`modo=emergencia`. Existe para o registro estar indisponível para resolver
digest, ou para alguém precisar voltar à mão com o Actions fora do ar. Um
token só, porque o forced-command entrega um argumento só.

> `main` não é aceita em lugar nenhum — nem pelo workflow, nem pelo script,
> nem como `emergencia:main`. É um ponteiro móvel, e implantar ponteiro móvel
> é exatamente o que esta issue fecha. Exceção que não deixa rastro vira regra
> sem ninguém decidir; por isso o `modo=` no log.

> O forced-command restringe o **comando**, não o argumento.

**Os caminhos** vêm de um **arquivo de configuração do root**, nunca do
ambiente. Caminho vindo do ambiente com `sudo` que preserva env é execução
arbitrária como root; e com `env_reset` o script nem rodaria.

**Os arquivos** que ele executa ou interpreta (`MIGRA`, o compose, o próprio
config) precisam ser **do root e não graváveis por grupo ou outros**; o
`ENV_FILE` precisa ainda não ser legível por grupo ou outros. Sem isso, quem
escreve no diretório de deploy escala para root trocando um arquivo. As
conferências e o `PATH` fixo valem **só quando o processo é root** — fora
disso não há privilégio para escalar, e é assim que o teste roda.

### Instalação no servidor

Arquivo de configuração, um por ambiente, **do root, modo 600**:

```sh
# /etc/complexo42/staging.conf
PROJECT_DIR=<diretório de deploy do ambiente>
ENV_FILE=<secrets/env do ambiente>
COMPOSE_APP=<docker-compose.app.yml do ambiente>
APP_PROJETO=<projeto Compose do app>     # != o do Supabase
REDE_PROXY=<rede externa do proxy>
ALVO_SAUDE=http://<alias do app>:3000/api/healthz
MIGRA=<caminho do aplicador de migrations>
SMOKE_IMAGEM=curlimages/curl@sha256:<digest>
# O container do banco DESTE ambiente, que o migra.sh usa. Sem ele o deploy
# recusa na partida -- de propósito: antes ele só falhava na etapa 3/5, depois
# de já ter feito o pull e sincronizado a infra.
DB_CONTAINER=<nome do container do Postgres do ambiente>
# Opcionais, com padrão: DB_USER=supabase_admin, DB_NOME=postgres
# Onde o deploy grava a infra, e onde guarda o manifesto do que gravou.
# O manifesto fica num diretório SÓ DO ROOT -- ver a seção da sincronia.
INFRA_DIR=<diretório de infra do ambiente>        # padrão: PROJECT_DIR
MANIFESTO=/etc/complexo42/infra-<projeto>.manifesto
# OPCIONAL. O projeto Compose do SUPABASE (≠ APP_PROJETO). Com ele, o deploy
# aplica sozinho a mudança do compose do Supabase e do kong.yml; sem ele,
# apenas avisa que a mudança ficou no disco sem valer. Ver "Aplicar a infra".
SUPABASE_PROJETO=<projeto Compose do Supabase>
```

O diretório do manifesto (`/etc/complexo42/`) precisa ser **do root e não
gravável por outros** — o deploy confere isso e aborta se não for.

> ⚠️ **Não é preciso `export` neste arquivo.** O `deploy.sh` lê a configuração com
> `.` (source), o que cria variáveis de **shell**, não de ambiente — e o `migra.sh`
> roda como **processo filho**. As variáveis que ele precisa (`DB_CONTAINER`,
> `DB_USER`, `DB_NOME`) são passadas **explicitamente** na chamada, justamente para
> que quem escreve a configuração não precise saber disso. Medido em 2026-11-27: sem
> a passagem explícita, `DB_CONTAINER=...` no arquivo simplesmente não chega, e o
> sintoma ("falta DB_CONTAINER") aponta para a configuração, que está correta.

`authorized_keys` do usuário de deploy — **uma chave por ambiente**:

```
command="/usr/local/sbin/complexo42-deploy-staging",no-pty,no-port-forwarding,no-agent-forwarding,no-X11-forwarding ssh-ed25519 AAAA... deploy-staging
```

O wrapper, **do root**, é quem lê o pedido e chama o sudo com o config fixo:

```sh
#!/bin/sh
# /usr/local/sbin/complexo42-deploy-staging  (root:root, 755)
set -eu
exec sudo -n /opt/complexo42/deploy.sh --config /etc/complexo42/staging.conf \
  "${SSH_ORIGINAL_COMMAND:-}"
```

sudoers, **sem `*` solto no caminho**:

```
complexo42stg01 ALL=(root) NOPASSWD: /opt/complexo42/deploy.sh --config /etc/complexo42/staging.conf *
```

> **Preferir isto ao grupo `docker`.** O grupo `docker` é root-equivalente:
> quem está nele roda `docker run -v /:/host`. Aqui o usuário executa **um**
> script, de caminho fixo, que ele não pode reescrever.

#### Script instalado no servidor não é código implantado

**Mesclar não o atualiza. O deploy não o atualiza. O CI verde não diz nada
sobre ele.** Dois arquivos deste repositório existem no servidor como **cópia
instalada**, fora do alcance do pipeline — é o preço de o deploy ser executado
por um `sudo` de caminho fixo, que é justamente o que impede o usuário de
deploy de reescrever o que ele mesmo executa.

| Caminho no servidor | Origem | Atualiza como |
|---|---|---|
| `/opt/complexo42/deploy.sh` | `deploy/deploy.sh` | **cópia à mão, como root** |
| `/opt/complexo42/migra.sh` | `deploy/migra.sh` | **cópia à mão, como root** |
| `/opt/complexo42/bootstrap-coordenacao.sh` e `email-hmac.mjs` | `deploy/` (mesmos nomes) | **cópia à mão, como root** (só no bootstrap, #295) |
| `/opt/complexo42/questionario-banco.sh` | `deploy/questionario-banco.sh` | **cópia à mão, como root** (#319) |
| `/opt/complexo42/criar-conta.sh` | `deploy/criar-conta.sh` | **cópia à mão, como root** (#332) |
| `/opt/complexo42/vigia.sh` | `deploy/vigia.sh` | **cópia à mão, como root** (#85) |

E estes **só existem no servidor** — não têm origem no repositório, então para
eles a pergunta "está igual à `main`?" não faz sentido:

| Caminho | O que é |
|---|---|
| `/usr/local/sbin/complexo42-deploy-staging` | wrapper do root (trecho acima) |
| `/etc/sudoers.d/complexo42-deploy-staging` | a regra única do sudo |
| `/etc/complexo42/<ambiente>.conf` | configuração do ambiente, 600 |
| `/etc/complexo42/infra-<projeto>.manifesto` | manifesto da ADR 0015, escrito pelo deploy |

**Conferência, sem número fixo em documentação.** Valor transcrito envelhece
em silêncio: no dia em que um PR tocar um desses scripts, o número aqui passa
a estar errado — e número errado numa conferência é pior que nenhum. O comando
abaixo calcula o esperado a partir da `main` e diz **qual** dos dois lados está
atrasado. **Cobre os sete** scripts de operador: um que ficasse fora da lista
seria conferido por ninguém, que é exatamente como a cópia velha do `migra.sh`
sobreviveu a três PRs.

```sh
for f in deploy.sh migra.sh bootstrap-coordenacao.sh email-hmac.mjs questionario-banco.sh criar-conta.sh vigia.sh; do
  inst=$(sudo md5sum "/opt/complexo42/$f" | cut -c1-12)
  main=$(curl -fsSL "https://raw.githubusercontent.com/felipemaion/Complexo42/main/deploy/$f" | md5sum | cut -c1-12)
  [ "$inst" = "$main" ] && e=ok || e="DESATUALIZADO"
  printf '%-26s instalado=%s  main=%s  %s\n' "$f" "$inst" "$main" "$e"
done
```

> **Arquivo que ainda não foi instalado faz o `md5sum` falhar**, e a linha sai
> vazia em vez de dizer o que houve. Num servidor que nunca precisou do
> bootstrap, `bootstrap-coordenacao.sh` e `email-hmac.mjs` **não existem** — e
> isso é legítimo. Ler "sem resposta" como "ok" é o erro a evitar: confira se as
> sete linhas saíram.

O modo não é o mesmo para todos: `deploy.sh`, `migra.sh`,
`bootstrap-coordenacao.sh`, `questionario-banco.sh`, `criar-conta.sh` e `vigia.sh` são `0755` (executados); `email-hmac.mjs` é `0644`
(lido pelo `node -e` dentro do container do app, nunca executado no host).

**Isto já custou caro.** O PR que fez o `migra.sh` avisar o PostgREST para
reler o esquema foi mesclado, o deploy rodou, o CI ficou verde — e o aviso não
acontecia, porque a cópia instalada seguia sendo a anterior. O corpo daquele PR
chegou a afirmar que "o `migra.sh` viaja na imagem": **as migrations viajam na
imagem; o script, não.** Rodar a conferência acima leva um segundo e responde
o que nenhum check responde.

> **Depois de qualquer PR que toque `deploy/deploy.sh` ou `deploy/migra.sh`:**
> reinstalar a cópia no servidor, com cópia de segurança antes e conferência de
> md5 depois. Enquanto isso não acontece, a mudança **não existe** em lugar
> nenhum que importe.

### A sincronia da infra (ADR 0015)

O compose do Supabase, o `kong.yml` e o `initdb/` **viajam na imagem** e o
deploy os sincroniza no servidor. A imagem é a fonte; o servidor é cópia.

> **Gravar o arquivo não é trocar o que roda.** O deploy faz `up -d` no projeto
> **do app**; o projeto do Supabase é outro. Sem `SUPABASE_PROJETO` na
> configuração, mudar `docker-compose.supabase.yml` ou `kong.yml` num PR deixa
> o arquivo novo no servidor com os containers rodando a configuração antiga —
> e o deploy passa **verde**. Aconteceu **quatro vezes em 2026-11-27**
> (`DB_CONTAINER`, os templates em português, o `kong.yml` do #247 e o
> `migra.sh`). Com `SUPABASE_PROJETO` configurado, o deploy aplica sozinho —
> ver **Aplicar a infra**, abaixo.

#### Aplicar a infra: o ensaio decide o escopo, a saúde decide se fica

Com `SUPABASE_PROJETO` na configuração, a etapa 2/5 aplica o que gravou:

| Mudou | O que o deploy faz |
|---|---|
| `docker-compose.supabase.yml` | `up -d` no projeto do Supabase — **o compose decide** quais serviços recriar |
| `kong.yml` | `up -d --no-deps --force-recreate kong`, **explícito** |
| `initdb/*` | **nada** (só roda em volume vazio; segue avisando) |
| nada | nada: nem ensaio |

**Por que o compose decide, e não uma lista nossa.** Mapa arquivo→serviço
escrito à mão envelhece em silêncio: no dia em que alguém acrescentar uma
variável ao `rest`, a lista não saberá. O `up -d` recria exatamente os
serviços cuja configuração resolvida mudou — medido quatro vezes com
`--dry-run`. O `kong.yml` é a exceção justamente porque é **bind mount**: o
compose não vê mudança no conteúdo do arquivo, então a recriação dele é
explícita.

**O deploy nunca toca o banco por conta própria — e a trava é prova positiva.**
Antes de qualquer coisa que mude estado, o deploy exige que o banco conhecido
do ambiente (`DB_CONTAINER`) **pertença ao projeto** `SUPABASE_PROJETO` —
lendo o label `com.docker.compose.project` do container. Sem conseguir essa
prova, ele não age.

> **Por que positiva, e não "procurar o banco no ensaio".** Com
> `SUPABASE_PROJETO` errado — um typo, ou o projeto de outro ambiente — o
> ensaio fala de containers com **outro nome**: nada casaria com
> `DB_CONTAINER`, a trava passaria, e o `up -d` subiria uma **segunda pilha**
> a partir do mesmo compose: banco novo, volume novo, `initdb` rodando.
> Lista negativa falha aberto exatamente quando a configuração está errada,
> que é quando ela mais precisa funcionar. Apontado em revisão do #281.

Depois disso, o ensaio (`up -d --dry-run`) é lido: se **não mencionar** o
banco, ou se o mencionar com `Creat*`, `Recreat*`, `Remov*`, `Stop*`, `Kill`
ou `Restart`, o deploy **para**, devolve os arquivos e chama um humano.
`Running` e `Start*` passam: banco parado que volta a subir não perde nada.
Recriar o Postgres encerra conexão, pode disparar o `initdb` num volume novo,
e não há rollback que devolva o que se perdeu.

**Volta atrás.** Falha ao aplicar, ou saúde que não volta, devolve cada arquivo
ao conteúdo anterior, **refaz o manifesto** e recria com ele. Refazer o
manifesto não é detalhe: sem isso o disco passa a divergir do que o manifesto
diz e o deploy **seguinte** trava como se alguém tivesse editado à mão.

> **O que a volta atrás não cobre, e é bom saber antes de precisar.** Arquivo
> que era **novo** nesta sincronia não tem conteúdo anterior: a devolução
> avisa no log e **não apaga** (apagar infra é pior que deixar). E se o
> processo morrer entre gravar e aplicar, o disco fica novo com os containers
> velhos — o deploy seguinte lê "tudo igual à imagem" e não reaplica. Nesse
> caso, a conferência é a de sempre: comparar o que o container está usando
> com o que está no disco. Um marcador de "aplicação pendente" resolveria, e
> está anotado como trabalho próprio.

**A saúde é o `smoke`, com as repetições dele.** O mesmo `/api/healthz` do
teste de fumaça — que desde a sonda de esquema passa pelo Kong e pelo
PostgREST, então Kong quebrado aparece ali. E repete até `ESPERA_SMOKE`: o Kong
levou **9 tentativas** para aceitar conexão em 2026-11-28, e 3 numa recriação
três horas antes. Conferir uma vez só reverteria mudança boa.

Falhar aqui falha o deploy **na etapa 2/5** — antes das migrations, com o app
antigo intacto.

**Quais arquivos — e a lista está no `deploy.sh`, não na imagem.** São
exatamente quatro: `docker-compose.supabase.yml`, `kong.yml`,
`initdb/01-extensions.sql` e `initdb/02-roles.sh`. A imagem é a fonte do
**conteúdo**; nunca a fonte dos **caminhos**.

> A diferença não é teórica. Se a imagem decidisse os caminhos, bastaria um
> arquivo novo em `deploy/` que o `.dockerignore` não excluísse — ele é uma
> lista de **exclusão**, então arquivo novo entra por omissão — para o root
> gravar o que a imagem quisesse dentro do diretório de deploy. O caso que
> fecha o assunto: a imagem passaria a trazer `migra.sh`, o deploy gravaria
> por cima do aplicador de migrations, e a **etapa seguinte o executa como
> root**. Com a lista fixa, arquivo sobrando **derruba o deploy**, e o CI
> confere a mesma lista contra a imagem a cada build.

Acrescentar arquivo à lista é decisão revisada em PR — que é onde ela deve ser.

**O manifesto é o que distingue atualização de edição à mão.** O deploy grava
o sha256 de cada arquivo que ele deixou. Ele mora **num diretório só do root**
(`/etc/complexo42/`), e **não** no diretório de deploy: modo 600 protege o
conteúdo do arquivo, não o nome. Quem pode escrever no diretório apaga o
manifesto e põe outro no lugar — e manifesto forjado **inverte** a garantia
desta seção, fazendo a divergência "conferir" e o deploy sobrescrever
justamente o arquivo que alguém editou à mão.

Na execução seguinte, para cada arquivo:

| situação | o que acontece |
|---|---|
| local **igual** à imagem | nada, e o log diz "tudo igual" |
| local **igual ao manifesto**, imagem mudou | troca, e registra `<sha antes> → <sha depois>` |
| local **não bate com nenhum dos dois** | **falha fechado**, sem sobrescrever |

A terceira linha é o ponto. Alguém editou à mão, e sobrescrever apagaria a
única pista disso — foi exatamente assim que o servidor ficou semanas com um
bootstrap de banco que ninguém revisava. Saídas: levar a mudança para o
repositório (o certo), ou rodar **uma vez** com `--adotar-infra` para aceitar
a versão da imagem.

**Como rodar o `--adotar-infra`:** à mão, no servidor, como root — ele **não
chega pelo SSH**, porque o forced-command passa só a referência da imagem:

```sh
sudo /opt/complexo42/deploy.sh --adotar-infra \
  --config /etc/complexo42/staging.conf sha256:<digest>
```

Antes de rodar, **olhe o que vai ser descartado** (`git show
origin/main:deploy/<arquivo>` contra o arquivo do servidor). A flag existe para
destravar, não para pular a revisão.

**Como o arquivo é gravado:** temporário no mesmo diretório → sha256 conferido
depois de escrito → `mv` (rename, que é atômico). Nenhum componente do caminho
pode ser link simbólico — nem o alvo, nem diretório nenhum até ele —, e link
**na imagem** com nome permitido também derruba: `cat` leria o destino **no
host**, e o deploy gravaria esse conteúdo no servidor.

**No `emergencia:<tag>` a sincronia é PULADA.** A imagem vem por tag, que é
ponteiro móvel, e gravar infra como root a partir de um ponteiro móvel é o
oposto do que o break-glass quer: ele existe para restabelecer serviço, não
para reescrever infra. Vantagem prática: infra divergente **não impede** de
voltar o serviço ao ar. A próxima implantação normal sincroniza.

**O rollback NÃO desfaz a sincronia.** Se o smoke falhar, o app volta para a
imagem anterior, mas os arquivos de infra no disco continuam os da imagem nova.
Na prática isso não quebra o rollback — quem sobe o app é o
`docker-compose.app.yml`, que fica **fora** da sincronia; o compose do Supabase
e o `initdb/` só valem quando alguém sobe o stack do banco ou recria o volume,
que são ações manuais. Mas é uma assimetria a ter em mente: depois de um
rollback, os arquivos no disco estão à frente do app no ar.

**O `.env` nunca é tocado** — e isso é imposto pelo **código**, não por
convenção: ele não está na lista, e há uma conferência no `deploy.sh` que
aborta se alguma entrada da lista coincidir com o `ENV_FILE`, o
`COMPOSE_APP`, o `MIGRA`, o log ou o próprio arquivo de configuração. Nem com
`--adotar-infra` ele entra.

**Os scripts de deploy não entram na imagem.** `deploy.sh`, `migra.sh`,
`backup.sh` e os testes rodam no host, como root; não têm o que fazer dentro
de uma imagem que roda sem privilégio e com disco só leitura.

**O compose do APP também fica fora**, de propósito: é o arquivo que o próprio
`deploy.sh` usa para subir o container. Sincronizá-lo no meio de um deploy
seria trocar o chão enquanto se anda nele.

> ⚠️ **Mudança em `initdb/` não chega a banco que já existe.** O `initdb/` só
> roda em **volume vazio**. O deploy sincroniza o arquivo, **avisa no log** que
> ele mudou e grava `initdb_mudou_recriacao_pendente` — mas **recriar o volume
> é ação manual**, porque automatizá-la seria automatizar perda de dados.
> O procedimento está em "Recriar o volume do Postgres" abaixo.

### Recriar o volume do Postgres (manual)

Três passos, **nesta ordem**. Inverter quebra o `up` com o stack já derrubado:

1. as variáveis novas que o compose exigir, no `secrets/env` (geradas **no
   servidor**, com cópia de segurança e conferência de contagem de linhas);
2. os arquivos de infra atualizados — o deploy já faz, ou à mão conferindo
   sha256 contra `git show origin/main:deploy/<arquivo>`;
3. `compose down` → `docker volume rm <projeto>_db-dados` → `compose up -d`.

Conferir ao fim: `postgres` com `rolcanlogin=false`, cada papel com senha
própria (comparando **impressões digitais**, nunca valores) e os serviços
saudáveis. **Fixe o método da impressão digital** — incluir ou não o newline
muda o hash, e comparar métodos diferentes produz divergência falsa.

### As cinco etapas, e por que nesta ordem

1. `pull` da imagem;
2. **sincronia da infra** (acima) — falhou, aborta antes de qualquer mudança;
3. **migrations** — falhou, aborta e o app **não** é trocado;
4. `up -d`;
5. **smoke** em `/api/healthz`; falhou, volta para a imagem anterior.

A imagem anterior vem do **`RepoDigests`** do container no ar, não do
`.Config.Image`: aquele é o **nome** com que o container subiu (pode ser uma
tag, que já se moveu), este é o **digest** que o Docker realmente tem. Sem
`RepoDigests` — imagem só local, nunca vinda de registro — o deploy segue
**sem rollback**, em vez de voltar para algo que não sabemos o que é.

O destino do rollback é a única coisa que o script escolhe sozinho, sem
ninguém revisar no momento. Por isso a checagem ali é a mais estreita do
script: aceita **só um digest do nosso próprio repositório**, com regex
ancorada. Recusa `:latest`, `:main`, tag qualquer, `repo` sem nada, digest
truncado, e digest de outro registro ou de `host:porta/outro`.

**O compose usa `image: ${APP_IMAGEM}`**, a referência completa — antes era
`ghcr.io/...:${APP_TAG}`, que não comporta digest, porque `@sha256:...` não
entra depois de um `:`.

> ⚠️ **Ordem obrigatória para a produção** (cópia do compose fora deste
> repositório, ADR 0009 §3): **trocar o `image:` para `${APP_IMAGEM}` ANTES**
> de atualizar o `deploy.sh`. Na ordem inversa, o compose antigo espera
> `APP_TAG`, o script novo manda `APP_IMAGEM`, e o `up` falha com
> "obrigatorio" — no meio de um deploy.

> **Migrations são expand/contract.** O rollback troca só o **app**; o banco
> continua no schema novo. Uma migration que remove ou renomeia coluna torna o
> rollback inútil — a versão anterior do app não roda sobre o schema novo.
> Remoção vem num PR **posterior**, depois que a versão que não usa mais a
> coluna estiver no ar.

### As migrations: `deploy/migra.sh`

**Elas viajam na imagem**, não num checkout do repositório no servidor. O
deploy recebe só a tag, então o que aplica o schema tem de ser exatamente o
que veio com aquela tag; um checkout à parte seria uma segunda fonte de
verdade, que diverge em silêncio e só aparece no pior momento. O Dockerfile
copia `supabase/migrations` para a imagem final — são `.sql` já públicos, e o
container do app não os lê.

O `migra.sh` cria um container da imagem **daquela tag**, copia as migrations
de dentro dele, apaga o container, e aplica no banco **só as pendentes**,
comparando com `supabase_migrations.schema_migrations` — a mesma tabela que o
CLI do Supabase usa.

**No fim, o `migra.sh` avisa o PostgREST para reler o esquema**
(`notify pgrst, 'reload schema'`). Isso não é zelo: o PostgREST monta o cache
de relações **na partida** e não repara em DDL depois disso. Migration
aplicada com ele já de pé fica **invisível para a API**, que responde `404`
com `PGRST205 "Could not find the table ... in the schema cache"` — e o
`/ready` dele segue em `200`, porque só diz que o processo está vivo.

Foi assim que o staging passou **19 horas** com o cache em 2 relações de 23
(2026-11-27 07:09 → 2026-11-28 02:31): o PostgREST subiu antes de o banco
terminar de migrar, toda leitura de perfil deu `404`, e **o login quebrava
depois de autenticar com sucesso** — pelo Google e pelo link por e-mail, os
dois, porque os dois terminam na mesma leitura. Nenhum health check acusou.

O aviso vai em **toda saída de sucesso, inclusive quando nada estava
pendente**: o cache pode estar velho sem existir migration nova, que é
exatamente o caso acima. E falhar nele é **fatal de propósito** — sem o aviso
a API serve esquema velho e o app quebra depois de o deploy dizer "ok".
O canal é o `db-channel` do PostgREST, `pgrst` por padrão; o container loga
`listening for database notifications on the "pgrst" channel` na partida, e
por isso o `NOTIFY` basta: não é preciso reiniciar nada.

**Uma transação por migration.** Falhou, nada *dela* fica gravado, e as
anteriores que passaram continuam valendo. Sem isso, uma falha no meio deixa
o schema num estado que nenhum arquivo descreve. A seguinte nem é tentada.

**O `psql` roda dentro do container do banco** (`docker exec`), não num
container com rede. Assim a senha do Postgres não atravessa lugar nenhum:
conexão local dentro do container é confiável. É uma troca consciente em
relação ao "container de uso único" da #81 — o isolamento que importa, abortar
sem tocar o app, continua valendo.

**Adoção de um banco já migrado.** Se a tabela de controle estiver vazia e o
`public` já tiver tabelas, o script **recusa** rodar. Motivo: reaplicar as
migrations ali é perigoso — parte delas roda calada (`create or replace`,
`drop ... if exists`) até alguma falhar, deixando o schema num estado que
nenhum arquivo descreve. Se o schema já corresponde a estas migrations, rode
**uma vez** com `--adotar`, que grava a linha de base sem executar nada.

> Conferido em 2026-11-19: o banco do **staging** tem `public` com **zero**
> tabelas e nenhuma tabela de controle — ele nunca foi migrado. Lá a aplicação
> é limpa, e `--adotar` não é necessário.

**O `psql` entra sem senha pelo socket.** Conferido no container do staging em
2026-11-19: `docker exec ... psql -U supabase_admin`, sem `-h`, conecta por
`trust`/`peer`. Não é suposição — se um dia o `pg_hba.conf` mudar, o deploy
trava aqui e o erro aparece no passo 2, antes de o app ser trocado.

**Cuidados ao escrever uma migration**, porque o script a envolve em
`begin`/`commit`:

- não abra `begin`/`commit` dentro do arquivo — a transação já é do script;
- termine cada comando com `;`;
- `CREATE INDEX CONCURRENTLY` **não funciona** dentro de transação; use índice
  comum, ou trate o caso à parte;
- `ALTER TYPE ... ADD VALUE` não pode ser usado na **mesma** transação que o
  criou; separe em duas migrations.

Variáveis: `APP_IMAGEM` (a referência completa, vem do `deploy.sh`),
`DB_CONTAINER` e, opcionais, `DB_USER` (padrão `supabase_admin`) e `DB_NOME`.

Testes: `deploy/migra.test.sh` (25 asserções, dublê de `docker`) e
`deploy/migra-integracao.test.sh` (12 asserções contra um Postgres de
verdade — é ele que prova que o DDL e a linha de controle caem juntos
quando uma migration falha; pula limpo sem Docker).

### Mudança de coluna ou de função: janela de deploy e expand/contract

O `migra.sh` aplica as migrations **antes** de o app novo subir. Migration que
renomeia, troca o tipo ou apaga uma coluna que o app em execução usa deixa o
app antigo quebrado (salvar e ler) até a troca, por segundos.

- **Hoje, aceito:** ainda não há app em produção. A #175 (`profiles.district`
  vira `district_code`) faz exatamente isso, de uma vez, e a migration aborta
  (em vez de perder dado) se algum nome de distrito não virou código. A #179
  (bairro cifrado) muda a **assinatura** de `save_own_profile` (parâmetro novo, função
  antiga apagada) e a forma do `export_own_data`: o app antigo também quebra
  ao salvar o perfil até a troca. Vale para toda mudança de assinatura de função
  que o app chama, não só para colunas.
- **Com app em produção, use expand/contract** em releases separados: (1)
  *expand*: migration que **só acrescenta** (coluna nova, função nova com outra
  assinatura), com o app lendo as duas e gravando a nova; (2) migrar os dados;
  (3) *contract*: depois que nenhuma versão antiga está no ar, migration que
  apaga a coluna ou a função velha. Nunca `drop`/`rename` no mesmo release em
  que o app muda.

### Duas proteções que não são óbvias

**Projeto Compose próprio.** O `secrets/env` traz o `COMPOSE_PROJECT_NAME` do
**Supabase**; herdá-lo faria app e banco dividirem projeto, e um
`up --remove-orphans` derrubaria o banco. O script passa `-p` explícito e
nunca usa `--remove-orphans`. Há teste para as duas coisas.

**`flock` em `/run`.** Um deploy por vez, e a trava fica fora do diretório que
o usuário de deploy consegue escrever — senão um link simbólico no lugar dela
vira escrita como root. Sai com 3 se outro deploy está em andamento.

### Registro

Uma linha por execução em `data/logs/deploy.log`: data, **imagem**
(referência completa — com digest a linha fica mais longa, e é o digest que
identifica o que subiu), **modo** (`normal` ou `emergencia`), resultado
(`ok`, `pull_falhou`,
`migrations_falharam`, `rollback_ok=<imagem>`, `rollback_falhou=<imagem>`,
`smoke_falhou_sem_rollback`, `up_falhou_sem_rollback`) e duração. O script recusa escrever se o log for link simbólico.

### Teste

`deploy/deploy.test.sh` — **47 asserções** com dublês de `docker`, `flock` e
`sleep`: roda no CI sem container, sem rede e sem servidor.


## O pipeline no GitHub (#81)

Dois workflows: `build.yml` publica a imagem, e chama `deploy.yml` passando a
**tag e o ambiente como entradas declaradas**.

Preferi `workflow_call` a `workflow_run`: ali os valores chegam explícitos em
vez de serem garimpados do payload do evento. Escolher o ambiente errado por
uma leitura equivocada do payload é o tipo de erro que só aparece quando algo
vai para produção sem querer.

O `build.yml` confere as migrations e move a tag `main` **pelo digest**, não
pela tag — entre publicar e conferir, uma tag pode ter sido movida, e o que
se confere tem de ser o que sobe. O `deploy.yml` manda **sempre um digest**
pelo SSH: no `workflow_dispatch` manual, resolve a tag digitada no runner.

| Evento | Tags publicadas | Ambiente |
|---|---|---|
| push na `main` | `sha-<curto>` e `main` | `staging`, automático |
| release publicada | `vAAAA.MM.DD[.n]` | `production`, **com aprovação** |

Quem exige a aprovação é o **environment `production`** do GitHub, não o
workflow. Os secrets são **por ambiente**, então a chave do staging não serve
para produção.

### Por que a `main` só se move depois da conferência

A tag imutável (`sha-*` ou `v*`) é publicada primeiro; a conferência das
migrations roda contra ela; e só então `main` é movida com
`buildx imagetools create`. Publicando tudo de uma vez, uma imagem que
reprova na conferência já estaria respondendo por `main` para quem puxasse
nesse intervalo.

A conferência compara a **impressão digital da lista ordenada de nomes e
conteúdos**, não a contagem: um arquivo renomeado ou alterado passaria por
uma contagem igual.

### Sem actions de terceiros

Só `actions/checkout`, fixado por SHA. Docker e SSH são shell: cada action a
mais é um SHA para fixar, acompanhar e confiar, e aqui não havia ganho.

### Nunca `ssh-keyscan`

A host key vem do secret `DEPLOY_KNOWN_HOSTS`, fixa. O `fail2ban` do servidor
bane o runner que faz varredura — e o deploy passa a falhar por um motivo que
não tem nada a ver com deploy.

### O que o Felipe precisa configurar uma vez

1. **Tornar o pacote do GHCR público.** Ele nasce **privado** mesmo em
   repositório público; sem isso o servidor não consegue baixar a imagem.
2. **Criar os environments** `staging` e `production`. Em **ambos**, em
   *Deployment branches and tags*, selecionar **Selected branches and tags** e
   permitir só o branch `main` e o padrão de tag `v*`. Em `production`, marcar
   os **revisores obrigatórios** e **Prevent self-review**.

   > Isto não é capricho de configuração: **é a defesa principal.** O
   > `workflow_dispatch` roda o arquivo **do branch escolhido**, então sem
   > essa restrição alguém com permissão de push cria um branch com o
   > `deploy.yml` editado e o staging — que não pede aprovação — entrega o
   > `DEPLOY_SSH_KEY`. Em produção, o revisor aprovaria um código que não leu.
   > O workflow também recusa referência fora de `main`/`v*`, mas essa é a
   > segunda linha: quem impede os secrets de chegarem é o environment.

3. **Secrets por environment:** `DEPLOY_HOST`, `DEPLOY_USER`,
   `DEPLOY_SSH_KEY`, `DEPLOY_KNOWN_HOSTS` (saída de `ssh-keyscan` rodada **na
   máquina dele**, uma vez, não no runner).
4. **Proteger as tags `v*` com um ruleset**, restringindo quem pode criá-las.
   A release é o gatilho de produção; o workflow já exige que o commit da
   release seja ancestral de `origin/main`, mas limitar quem cria a tag fecha
   o caminho antes.
5. **No servidor:** usuário e chave de deploy por ambiente, `authorized_keys`
   com forced-command, e a regra de sudo — as linhas exatas estão na seção
   "Deploy do app" acima.

Enquanto 1 a 4 não existirem, o `build.yml` publica a imagem e o `deploy.yml`
falha dizendo qual secret falta — que é o comportamento desejado, e não um
deploy pela metade.
