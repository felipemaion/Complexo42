# ADR 0009: Hospedagem da POC em servidor próprio, com Supabase auto-hospedado

- **Status:** Aceito (pelo gestor, em 2026-11-19)
- **Data:** 2026-11-18
- **Complementa:** o ADR 0001 (stack).

## Contexto

- **O mantenedor oferece uma VPS** com Docker, um proxy reverso (Caddy) e a Cloudflare na
  frente, sem custo (plano Always Free). Esse servidor já hospeda outros projetos, cada um
  isolado em seu container.
- **Endereço:** a POC fica em **`complexo42.maionesys.com`**.
- **Prazo:** o cadastro dos ex-alunos abre no fim de janeiro. Em janeiro, a plataforma
  precisa estar **pronta e no endereço definitivo**, sem migração de última hora.
- **O ADR 0001 tinha descartado VPS** porque ela exigiria servidor gerenciado por
  voluntários. Aqui não exige: quem opera o servidor é o mantenedor, e os voluntários
  continuam sem acesso à produção.
- **Restrições do servidor:**
  - processador **ARM64**, então todas as imagens precisam ser `linux/arm64`;
  - **2 vCPUs** e **12 GB de RAM**, compartilhados com outros projetos;
  - **porta 25 bloqueada**, então e-mail só sai por um relay SMTP;
  - **nenhum container publica porta**: o Caddy alcança cada app pela rede Docker interna.
- **O código já assume Supabase:** RLS, Auth, migrations e testes pgTAP. Trocar de banco ou
  de autenticação agora custaria semanas.

## Decisão

### 1. Arquitetura

```
Navegador → Cloudflare (proxy, TLS, WAF) → Caddy do servidor
   ├─ /auth/v1/*  → kong → gotrue (Supabase Auth)      ← único caminho do Supabase exposto
   └─ /*          → app (Next.js, modo standalone)
                     └─ rede interna → kong → postgrest / gotrue
                                           └→ postgres (Supabase)
```

- **Supabase auto-hospedado em versão mínima:** `db` (Postgres), `auth` (GoTrue), `rest`
  (PostgREST) e `kong` (gateway). Ficam de fora `realtime`, `storage`, `analytics` e
  `functions`, para economizar RAM e reduzir a superfície de ataque. O `studio` e o `meta`
  só sobem sob demanda, acessíveis apenas por túnel SSH, nunca publicados.
- **Só a autenticação fica exposta.** A API de dados (`/rest/v1`) **não é publicada**: o
  navegador fala apenas com o Next.js, que consulta o banco pela rede interna usando o JWT
  do usuário. Isso reforça a R14 (o navegador não consulta tabelas com dado pessoal), e a
  RLS continua valendo.
- **O código é o mesmo em todo lugar.** Localmente se usa `supabase start` (CLI) e no
  servidor o Supabase auto-hospedado. As migrations são as mesmas (`supabase/migrations/`),
  aplicadas no deploy.
- **Limites de recursos** em cada serviço (`mem_limit`, `cpus`) e meta de **≤ 2 GB de RAM**
  por ambiente.

### 2. Ambientes

| Ambiente | Endereço | Dados | Atualização |
|---|---|---|---|
| Local | `localhost` | seeds fictícios | cada voluntário |
| Staging | `complexo42-staging.maionesys.com` | **só fictícios** (seeds, inclusive em volume) | automática a cada merge na `main` |
| Produção | `complexo42.maionesys.com` | reais | por **release** (tag `vAAAA.MM.DD`), com aprovação do mantenedor |

- **O staging usa um hífen no nome, e não um subdomínio de segundo nível.** O certificado
  gratuito da Cloudflare cobre só um nível (`*.maionesys.com`); um endereço como
  `staging.complexo42.maionesys.com` daria erro de TLS no proxy.
- **Cada ambiente tem suas próprias chaves**: JWT, chave de cifra e HMAC (ADR 0003). Nenhum
  segredo é compartilhado entre staging e produção.
- **Até o lançamento**, o endereço de produção mostra uma página "em breve", e o teste do
  piloto roda em produção com contas reais convidadas.

### 3. Imagem, CI e deploy

- **Build:** a imagem do app é gerada no GitHub Actions num **runner ARM64 nativo**
  (gratuito para repositório público), sem emulação. Ela vai para o **GHCR** como pacote
  público, porque o código já é público. O Dockerfile tem várias etapas, usa a saída
  `standalone` do Next.js, roda com usuário não-root e não leva nenhum `.env` dentro.
- **Deploy em quatro etapas,** disparado pelo Actions por SSH com **uma única chave restrita
  a um comando** (forced-command), por ambiente:
  1. baixa a imagem pela tag;
  2. aplica as migrations pendentes com um job de uso único; se falhar, aborta antes de
     trocar o app;
  3. recria o container do app;
  4. faz o teste de fumaça em `/api/healthz`; se falhar, volta para a tag anterior.
- **Os segredos vivem só no servidor**, num arquivo `secrets/env` com permissão `0600`, fora
  do repositório e fora da imagem. O GitHub guarda só o necessário para o SSH do deploy.
- **O compose e o script de deploy de produção ficam no repositório de infraestrutura do
  mantenedor, não neste.** Quem tem permissão de push aqui não decide portas, volumes nem
  limites de produção. Este repositório traz um `deploy/` de **referência**, usado no
  staging e em ambientes de teste.

### 4. Backup e restauração

- **`pg_dump` diário** (formato custom), **cifrado** com `age` antes de sair do container,
  com retenção de 7 diários e 4 semanais no servidor.
- **Cópia diária para fora da VPS**, num destino gratuito definido na issue de backup. O
  backup é cifrado, e a chave privada do `age` fica **só offline** com os mantenedores
  (ADR 0003 §7).
- **Teste de restauração mensal, cronometrado:** sobe um Postgres vazio, restaura e roda uma
  contagem de controle. Backup que nunca foi restaurado não conta.

### 5. E-mail

O link mágico e os convites saem por um **relay SMTP com plano gratuito** (decisão e limites
na #73). O login com Google é a via principal, porque não depende de cota de e-mail.

### 6. Borda e monitoramento

- **Cabeçalhos no Caddy ou no Next.js:** CSP restrita (ADR 0007 §5), HSTS,
  `X-Content-Type-Options`, `Referrer-Policy` e `Permissions-Policy`.
- **Na Cloudflare:**
  - proxy ligado e SSL *Full (strict)*;
  - regra de **rate limit** em `/auth/v1/*` (o plano gratuito permite uma);
  - bloqueio dos caminhos que os robôs varrem (`/.env`, `/.git`, `/wp-*`).
- **Monitoramento:** `/api/healthz` (app + banco) monitorado de fora por serviço gratuito,
  com alerta para os mantenedores. Os logs da aplicação vão para `data/logs/`, para
  sobreviverem à recriação do container, sem nenhum dado pessoal (R11).

### 7. Portabilidade

A pilha inteira é um `docker compose` com volumes e um backup cifrado. Mudar para outra
máquina (outra VPS ou uma infraestrutura da organização) é seguir o **runbook de migração**:
provisionar, restaurar o backup, trocar o DNS e conferir. O runbook é **ensaiado antes do
lançamento**, com o tempo medido.

### 8. Servidor dedicado (em avaliação, #98)

A intenção é rodar o Complexo42 numa **VM própria**, igual à atual (Oracle Always Free:
ARM64, 2 OCPU, 12 GB), se a cota gratuita da conta permitir. O Always Free da Oracle soma
**4 OCPU e 24 GB de A1 por conta**, e a VM atual usa metade, mas isso precisa ser confirmado
no console da Oracle.

- **Se houver cota,** a VM dedicada acaba com os recursos e a rede de proxy compartilhados
  (veja as Consequências). Todo o resto deste ADR continua igual, porque a pilha é
  portátil (§7).
- **Se não houver,** o Complexo42 segue no servidor atual, com os limites por serviço.

## Alternativas consideradas

| Opção | Por que não |
|---|---|
| Supabase Cloud (gratuito) para banco e Auth, app na VPS | Pausa após 7 dias sem uso e limite de 500 MB, e os dados ficariam num serviço fora do nosso controle. Continua sendo o **plano de contingência**: o código é o mesmo |
| Postgres puro + autenticação própria (Auth.js) | Exigiria reescrever o modelo de RLS, que depende do JWT do Supabase, e os testes pgTAP já planejados |
| Supabase auto-hospedado completo (todos os serviços) | Gasta de 3 a 4 GB de RAM a mais e traz Studio, Storage e Realtime expostos, que não usamos (o portfólio não guarda arquivos) |
| Cloudflare Pages/Workers ou Vercel | Exigiriam o banco em outro lugar e o adaptador OpenNext. A VPS simplifica e evita cobrança por pico |
| Construir a imagem no próprio servidor | Ocuparia as 2 vCPUs por minutos e afetaria os outros projetos. O build em CI ARM64 é gratuito |

## Consequências

- (+) Custo zero (R19), sem pausa por inatividade e com os dados sob nosso controle.
- (+) O mesmo código e as mesmas migrations do local à produção.
- (+) A API de dados não é exposta, o que reduz bastante a superfície de ataque.
- (−) **Operar o Supabase vira responsabilidade nossa:** atualizações de imagem, backup e
  segredos. Isso é mitigado com versões fixadas, um runbook e um único operador com acesso.
- (−) **Ponto único de falha:** uma VPS só. Mitigado pelo backup fora dela e pelo runbook de
  migração ensaiado. Em queda prolongada, a contingência é restaurar no Supabase Cloud
  gratuito.
- (−) **Os recursos são compartilhados com outros projetos do servidor** (até a VM dedicada, §8). É preciso
  respeitar os limites e evitar build e deploy simultâneos.
- (−) **A rede interna do proxy também é compartilhada** (até a VM dedicada, §8).
  - **Situação:** só o `kong` entra nela, porque o Caddy precisa alcançá-lo. Ainda assim,
    um container de outro projeto do servidor consegue chamar `/rest/v1` por dentro, com a
    chave `anon`. De fora, `/rest/v1` dá 404.
  - **O que fica protegido:** o `db`, o `auth` e o `rest` ficam numa rede própria do
    projeto, fora da rede do proxy.
  - **Barreira real:** a **RLS**, porque a chave `anon` só enxerga o que as políticas
    liberam para quem não tem login (R14).
  - **Para fechar de vez:** uma rede de proxy só do Complexo42, o que exige recriar o
    proxy, numa janela combinada. **Risco aceito até o lançamento [?].**
