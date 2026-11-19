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
