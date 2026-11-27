# ADR 0015: Os arquivos de infraestrutura do repositório são a fonte única

- **Status:** Aceito (pelo gestor, em 2026-11-27)
- **Data:** 2026-11-27
- **Relacionado:** ADR 0009 §3 (imagem, CI e deploy), #81 (pipeline), #95 (senha por papel),
  #9 (limites de taxa do login)

## Contexto

O `deploy/` deste repositório (compose do Supabase, `kong.yml`, `initdb/`) foi copiado **à mão**
para o servidor quando o staging subiu, e **nada o reconcilia desde então**. O pipeline da #81
implanta a *imagem do app*; esses arquivos ficaram de fora.

Em 2026-11-27, ao recriar o volume do Postgres do staging, isso apareceu — e o que apareceu não
é teórico. Comparação por sha256 entre o servidor e a `main`:

| arquivo | confere? |
|---|---|
| `kong.yml` | sim |
| `initdb/01-extensions.sql` | sim |
| `initdb/02-roles.sh` | **não** |
| `docker-compose.supabase.yml` | **não** |

As duas divergências **não são ajuste local deliberado**: são a versão anterior ao #95 e ao #9.
Consequências que estavam valendo no servidor, sem ninguém saber:

1. **`rest` e `auth` conectavam ao banco com a senha do superusuário.** O compose antigo usa
   `${POSTGRES_PASSWORD}` nas duas URLs; o antigo `02-roles.sh` dá a mesma senha a todos os
   papéis. Vazar o ambiente de qualquer um dos dois containers entregava o banco inteiro — que é
   exatamente o que o #95 corrigiu, no repositório, há semanas.
2. **O GoTrue rodava sem nenhum limite de taxa.** Os `GOTRUE_RATE_LIMIT_*` do #9 não existem na
   versão antiga, e `/auth/v1` está publicamente acessível, com SMTP configurado.
3. **Recriar o volume não conserta nada**, porque o `initdb/` executado é o do servidor. Foi o
   que aconteceu: o volume foi recriado e o `postgres` continuou com LOGIN.

O problema não é cada divergência; é que **só se descobre por acidente, e no pior momento**.

## Decisão

**Os arquivos de infraestrutura do repositório são a fonte única.**

1. **O que é do servidor sai deles.** Hosts, portas, caminhos e segredos saem dos arquivos
   versionados e passam a viver num `.env` **do root**, fora do repositório. Os arquivos
   versionados referenciam variáveis; não carregam valor de ambiente nenhum.
2. **O deploy sincroniza a partir do artefato do build.** Os arquivos viajam **dentro da
   imagem**, como as migrations já fazem desde a #81 — mesma referência, mesma conferência,
   mesma origem.
3. **O deploy confere sha256 antes de trocar** e **registra no log o que mudou**. Sincronização
   silenciosa é como chegamos aqui.
4. **O deploy nunca sobrescreve o `.env`.** Ele é do operador; o pipeline não o toca.
5. **Falha fechado se o arquivo local divergir sem ter vindo do deploy.** Divergência não
   explicada é sinal de alguém ter mexido à mão — e seguir em frente por cima disso apagaria a
   única pista.
6. **Mudança em `initdb/` que exija recriar o volume continua sendo ação manual documentada.**
   O `initdb/` só roda em volume novo; automatizar a recriação seria automatizar perda de dados.

## Alternativa rejeitada: repositório de infraestrutura separado

Mover compose, `kong.yml` e `initdb/` para o repositório privado de infraestrutura, deixando
este repositório sem eles.

**Por que não:**

- **O ADR 0009 §3 já reserva ao repositório de infraestrutura o que é de produção** — portas,
  volumes e limites que quem tem push aqui não decide. O que está em discussão aqui é outra
  coisa: o **bootstrap do banco** e a composição dos serviços, que são parte do desenho do
  sistema e precisam ser revisados junto com o código que depende deles. O #95 e o #9 são
  exatamente isso: mudanças de segurança que nasceram em PR, com revisão, e que teriam ficado
  invisíveis se o arquivo vivesse fora.
- **Separar não resolve o problema, muda de lugar.** Dois repositórios também divergem; a
  diferença é que aí ninguém tem o `git show origin/main` para comparar num comando.
- **Perde-se a conferência barata.** Hoje `sha256` contra `git show origin/main:deploy/<arquivo>`
  responde em segundos. Com o arquivo fora, a comparação depende de ter o outro repositório
  clonado e no commit certo.

A separação continua valendo para **valores de produção** (ADR 0009 §3), que é o que ela foi
criada para proteger — e é o item 1 desta decisão, agora explícito: valor de ambiente sai do
arquivo versionado.

## Consequências

**Boas.** Mudança de infra na `main` chega ao servidor pelo mesmo caminho do código, com a mesma
revisão. A divergência deixa de ser descoberta por acidente: ou o deploy a corrige, ou ele para.

**Custo.** O `deploy.sh` cresce, e ganha um modo de falha novo (divergência local não explicada)
que precisa de mensagem clara e de uma saída documentada para o operador.

**Não resolve sozinho:** o `initdb/`. Ele só roda em volume vazio, então sincronizar o arquivo
não muda um banco que já existe. A decisão deixa isso explícito em vez de fingir que cobre.

## O caso que originou isto, já corrigido à mão

Feito no staging em 2026-11-27, com autorização do gestor, **em três passos cuja ordem é
obrigatória**:

1. as duas senhas novas (`AUTHENTICATOR_PASSWORD`, `AUTH_ADMIN_PASSWORD`) geradas **no servidor**
   e acrescentadas ao `secrets/env`;
2. `docker-compose.supabase.yml` e `initdb/02-roles.sh` atualizados a partir da `main`,
   conferindo sha256 antes de valer;
3. volume do Postgres recriado, para o `02-roles.sh` novo dar a cada papel a senha dele.

Inverter a ordem quebra: o compose da `main` exige as duas variáveis, e sem elas o `up` falha —
no meio da operação, com o stack já derrubado.

Resultado medido: `postgres` com `login=false`; `rest` conectando como `authenticator` e `auth`
como `supabase_auth_admin`, **cada um com senha própria**; os `GOTRUE_RATE_LIMIT_*` no ar; e os
quatro arquivos do `deploy/` conferindo com a `main`.

**É esta sequência que a decisão existe para não precisar repetir à mão.** Três passos, ordem
rígida, verificação em cada um — executada por alguém que precisa lembrar de tudo isso, num
servidor onde o erro só aparece depois. O item 6 da decisão continua valendo: a recriação do
volume segue manual, porque automatizá-la seria automatizar perda de dados. O que o deploy passa
a cobrir são os passos 2 e a detecção de que ele é necessário.

## Risco residual: o conteúdo do compose, não os caminhos

A lista de arquivos que o deploy grava como root é **fixa no `deploy.sh`** — a imagem é a
fonte do **conteúdo**, nunca dos **caminhos** (ver `docs/OPERACAO.md`, "A sincronia da
infra"). Isso fecha a escalada por caminho: a imagem não pode fazer o root sobrescrever o
aplicador de migrations, que a etapa seguinte executa.

**O que esta decisão não fecha, e é preciso dizer em voz alta:** quem controla o que entra na
imagem controla o **conteúdo** desses quatro arquivos. E o `docker-compose.supabase.yml`
descreve containers que sobem **como root no host**. Um compose com `privileged: true`, com
`/var/run/docker.sock` montado, com `- /:/host` ou com `pid: host` é saída do container para a
máquina — sem precisar de nenhuma falha de software.

Isso é **inerente** a "a infra do repositório é a fonte única". Não é um defeito da
implementação: é o preço da decisão, e o preço é aceitável porque o que protege esse conteúdo é
o mesmo que protege o resto do código — revisão de PR, `main` protegida, ancestralidade provada
no build e implantação por digest. Quem consegue mesclar um compose malicioso na `main` também
consegue mesclar um `src/` malicioso.

Três consequências práticas:

1. **Mudança no `docker-compose.supabase.yml` é mudança de privilégio**, e merece a mesma
   atenção de revisão que uma mudança no `deploy.sh` — não a de um arquivo de configuração.
2. **O CI tem um grep de sanidade** (`privileged`, `docker.sock`, `- /:`, `cap_add`,
   `pid: host`, `network_mode: host`). Ele não substitui a revisão; pega a regressão óbvia e
   obriga quem precisa de um desses a tirá-lo da lista deliberadamente, em PR.
3. **Não estender a lista sem este raciocínio.** Cada arquivo novo nela é uma superfície nova
   que a imagem passa a controlar no host.
