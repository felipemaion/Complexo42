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

> **Atenção:** o `02-roles.sh` só roda no **primeiro start de um volume vazio**. Um volume
> criado antes da #95 continua com o `postgres` com login e senha, e é preciso corrigir à mão
> (abaixo). Confira sempre no banco real, e não neste documento:
>
> ```sql
> select rolname, rolcanlogin, rolpassword is not null as tem_senha
>   from pg_authid where rolname = 'postgres';   -- esperado: f, f
> ```

O `02-roles.sh` aplica as senhas **na criação do volume**. Em volume que já
existe, a troca é por `ALTER ROLE`, de dentro do container do banco:

```bash
# le a senha do arquivo de segredos, sem ecoar no terminal nem no histórico
docker compose -f docker-compose.supabase.yml --env-file <segredos> \
  exec -T db psql -v ON_ERROR_STOP=1 -U supabase_admin -d postgres \
  -v senha="$(grep -m1 '^AUTHENTICATOR_PASSWORD=' <segredos> | cut -d= -f2-)" \
  -c "ALTER ROLE authenticator WITH LOGIN PASSWORD :'senha'"
# idem para supabase_auth_admin, com AUTH_ADMIN_PASSWORD

# postgres sem login e sem senha (as migrations do GoTrue só precisam que o papel exista)
docker compose -f docker-compose.supabase.yml --env-file <segredos> \
  exec -T db psql -v ON_ERROR_STOP=1 -U supabase_admin -d postgres \
  -c "ALTER ROLE postgres WITH NOLOGIN PASSWORD NULL"
```

Depois do `ALTER ROLE`, reinicie quem usa aquela senha (`restart rest` ou
`restart auth`): a conexão antiga continua válida até o processo reconectar, e
sem o restart o erro só aparece horas depois.

## Casas (ADR 0011)

O `supabase/seed.sql` **não roda em produção**, e a tabela `houses` precisa ter uma linha para
cada casa de `config/instance.ts` (`houses[].id`): sem a linha, `accept_house` recusa a casa
("casa indisponível"). O bloco `insert into public.houses ...` do seed é a fonte, e
`tests/house-units.test.ts` garante que ele tem exatamente as casas da config. O comando é
idempotente (rodar de novo não duplica; reativa uma casa desativada). Na primeira subida e
sempre que a config ganhar casa:

```bash
sed -n '/^insert into public.houses (key) values/,/;$/p' supabase/seed.sql \
  | docker compose -f docker-compose.supabase.yml --env-file <segredos> \
      exec -T db psql -v ON_ERROR_STOP=1 -U supabase_admin -d postgres
```

Casa que **saiu** da config não é apagada (tem vínculos e histórico): desative-a, e ela deixa de
aceitar entradas e coordenadores novos (quem já está nela continua):

```bash
docker compose -f docker-compose.supabase.yml --env-file <segredos> \
  exec -T db psql -v ON_ERROR_STOP=1 -U supabase_admin -d postgres \
  -c "update public.houses set active = false where key = '<id-da-casa>'"
```

## Questionário das casas (ADR 0014)

O app pontua o questionário e assina o resultado; o banco só aceita resultado assinado. A chave
`QUESTIONNAIRE_SIGNING_KEY` (gerada por `deploy/gen-secrets.sh`) precisa estar **igual** no
ambiente do app e em `app.server_secrets` (a tabela não tem grant: só funções do banco leem). Na
primeira subida e ao trocar a chave (valor lido do arquivo de segredos, sem ir para o histórico):

```bash
set -eu
KEY=$(sed -n 's/^QUESTIONNAIRE_SIGNING_KEY=//p' <segredos>)
[ -n "$KEY" ]
printf "insert into app.server_secrets (name, value) values ('questionnaire_signing_key', '%s') on conflict (name) do update set value = excluded.value;\n" "$KEY" \
  | docker compose -f docker-compose.supabase.yml --env-file <segredos> \
      exec -T db psql -v ON_ERROR_STOP=1 -U supabase_admin -d postgres
```

Sem a chave no banco, curta (menos de 32 caracteres) ou diferente da do app, gravar o resultado do
questionário falha (fechado).

- **Janela de relógio:** o banco recusa assinatura emitida há mais de 5 minutos (ou mais de 30
  segundos no futuro). Mantenha os relógios do app e do banco sincronizados (NTP).
- **Rotação da chave:** gere outra, **instale no banco e no app juntos** (o passo acima e o
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
A versão do termo do arquivo do questionário também precisa estar em
`app.questionnaire_term_versions`.

**O totem e as respostas do questionário ficam cifrados no banco** (`totem_enc`, `answers_enc`,
AES-256-GCM, ADR 0003 e ADR 0014 §5): o Postgres nunca recebe nem devolve esses valores em claro,
então o log do Postgres e o `pg_stat_statements` não os expõem. Verificações:
- `FIELD_ENCRYPTION_KEY` é a mesma do app que grava e lê (perdê-la perde totem e respostas, como
  o nome e o contato). A **rotação** de chaves (ADR 0003 §5) recifra também `totem_enc` e
  `answers_enc`.
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

## O que está exposto

Só `/auth/v1/*`, publicado pelo proxy reverso. `/rest/v1` responde 404 de
fora: o app o consome pela rede interna. A barreira real dos dados é a RLS,
não o kong — ver `docs/adr/0009` §1.

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

Configuração só por variável de ambiente, validada com Zod na subida
(`src/server/env.ts`). Variável inválida, ou faltando em produção, derruba o
processo com o **nome** da variável no log, nunca o valor.

| Variável | Para quê |
|---|---|
| `DB_HEALTH_URL` | obrigatória em produção; no servidor, `http://rest:3001/ready` (admin do PostgREST) |
| `HEALTH_TIMEOUT_MS` | tempo máximo da checagem do banco (padrão 2000) |
| `LOG_DIR` | onde fica o `app.log` (padrão `data/logs`) |

`GET /api/healthz` responde `{status, version, db}` com `Cache-Control: no-store`:
200 quando o banco responde e 503 (`degraded`) quando não responde ou não está
configurado. O motivo da falha (`timeout`, `network`, `http_error`) vai só para
o log. Os logs são JSON, no stdout e em `data/logs/app.log`, e mascaram nome,
telefone e e-mail (R11). O compose de referência é `deploy/docker-compose.app.yml`:
sistema de arquivos só leitura, sem `ports:`, com `mem_limit`. Use nele um
`COMPOSE_PROJECT_NAME` diferente do Supabase e aponte `SUPABASE_NETWORK` para a
rede `<projeto-do-supabase>_interna`.

**Tamanho do corpo (#86).** As server actions aceitam até 2 MB (`next.config.ts`),
por causa do envio da lista de autorizados (`/coordenacao/autorizados`, até 1,5 MB).
O limite vale para todas as actions, inclusive as sem login: o proxy de borda pode
baixá-lo por rota e deixar os 2 MB só para `/coordenacao/autorizados`.

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

**CSP (#86).** Quando a CSP entrar, ela precisa liberar o Turnstile:

| Diretiva | Origem |
|---|---|
| `script-src` | `https://challenges.cloudflare.com` |
| `frame-src` | `https://challenges.cloudflare.com` |

A chamada ao siteverify parte do servidor, não do navegador, então não entra
em `connect-src`.

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
./deploy/restore-test.sh <arquivo.age> <chave-privada>
```

Sobe um Postgres descartável com a **mesma imagem** do ambiente, decifra,
restaura, imprime as contagens de controle (perfis, unidades, vínculos, papéis,
municípios) e o **tempo em segundos**, e apaga o container no fim. Não toca o
banco do ambiente.

A chave privada entra só durante o teste e sai com quem a trouxe: o script não
a copia nem a imprime. No servidor, apague a cópia temporária ao terminar.

Rodar **antes do primeiro dado real** e **todo mês**, anotando o tempo na #84.

### Restaurar em produção: reaplicar as exclusões de conta (#18)

Um backup é anterior às exclusões feitas depois dele. Restaurar sem cuidado traria de volta
contas que as pessoas apagaram (LGPD art. 18, VI). Se o banco atual ainda abre, **antes** de
restaurar, guarde os ids:

```sql
select distinct target_id from public.audit_log where event = 'account_deleted';
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

Falha gera alerta pela #85; para isso cada script sai com código ≠ 0 em
qualquer erro.

#### 6. Testar a restauração a partir do Drive

```bash
./deploy/restore-test.sh --do-remoto <chave-privada>
```

**É este o teste que vale.** Restaurar um arquivo local prova que o dump está
bom; só o `--do-remoto` prova que a cópia fora da VPS existe, chegou inteira e
pode ser recuperada — ele baixa o `.age` mais novo do Drive, restaura num
Postgres descartável e apaga o que baixou no fim.


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
Isso foi medido, não suposto. Aceita uma tag (`sha-<hex>`, `vAAAA.MM.DD[.n]`,
`main`) **ou um digest** (`sha256:<64 hex>`).

> **Por que digest (#161).** Tag é ponteiro, digest é conteúdo. Entre o build
> e o deploy uma tag pode passar a apontar para outra imagem. O workflow manda
> o digest que o build publicou **e conferiu**. A tag `sha-<curto>` também é
> imutável por convenção nossa, então isto fecha uma janela, não corrige um
> buraco aberto.

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
```

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

### As quatro etapas, e por que nesta ordem

1. `pull` da imagem;
2. **migrations** — falhou, aborta e o app **não** é trocado;
3. `up -d`;
4. **smoke** em `/api/healthz`; falhou, volta para a imagem anterior.

A imagem anterior vem do **ID** do container no ar (`compose ps -q`), não de
um nome montado à mão nem de arquivo de estado: o sufixo `-app-1` é convenção
do Compose, e arquivo mente quando alguém mexe à mão. O script guarda a
**referência completa**, então voltar para uma imagem presa por digest é o
melhor caso, não um impedimento.

Recusa voltar para `:main` (móvel), para uma referência truncada (`repo:` sem
tag, que um container sem imagem registrada produz) e para `repo` sem tag nem
digest (`:latest` implícito). Nesses casos diz que não há rollback possível em
vez de fingir que fez.

**O compose usa `image: ${APP_IMAGEM}`**, a referência completa — antes era
`ghcr.io/...:${APP_TAG}`, que não comporta digest, porque `@sha256:...` não
entra depois de um `:`. **Quem mantiver uma cópia do compose fora deste
repositório (a produção, por ADR 0009 §3) precisa da mesma mudança.**

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
identifica o que subiu), resultado (`ok`, `pull_falhou`,
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

O `build.yml` passa adiante **o digest** da imagem que publicou, além da
tag; o `deploy.yml` manda o digest pelo SSH quando ele existe (no
`workflow_dispatch` manual, onde não há, manda a tag).

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
