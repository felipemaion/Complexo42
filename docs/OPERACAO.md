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
postgres`), mas é **NOLOGIN**: ninguém se conecta com ele.

O `02-roles.sh` aplica as senhas **na criação do volume**. Em volume que já
existe, a troca é por `ALTER ROLE`, de dentro do container do banco:

```bash
# le a senha do arquivo de segredos, sem ecoar no terminal nem no histórico
docker compose -f docker-compose.supabase.yml --env-file <segredos> \
  exec -T db psql -v ON_ERROR_STOP=1 -U supabase_admin -d postgres \
  -v senha="$(grep -m1 '^AUTHENTICATOR_PASSWORD=' <segredos> | cut -d= -f2-)" \
  -c "ALTER ROLE authenticator WITH LOGIN PASSWORD :'senha'"
# idem para supabase_auth_admin, com AUTH_ADMIN_PASSWORD
```

Depois do `ALTER ROLE`, reinicie quem usa aquela senha (`restart rest` ou
`restart auth`): a conexão antiga continua válida até o processo reconectar, e
sem o restart o erro só aparece horas depois.

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

Depois de restaurar, como `supabase_admin` (o `postgres` é NOLOGIN), apague cada id da lista
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
