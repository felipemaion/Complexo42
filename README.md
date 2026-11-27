# Complexo42

Plataforma para organizar **turmas** que discutem, propõem e realizam ações na sua região,
cumprindo **missões** gamificadas: doar sangue, limpar uma praça, escrever e protocolar um
projeto de lei, discursar na câmara… Cada etapa validada vira um **feito**, rende **pontos** e
pode render **badges**. **Monitores e gestores** identificam as habilidades dos alunos, publicam
missões e validam as entregas. Primeira instância: a Academia. O acesso é hierárquico: o monitor vê sua
turma/equipe, o gestor estadual vê seu estado e o gestor nacional vê tudo. Os dados pessoais
são guardados **cifrados**.

Desenvolvida pelos próprios alunos de TI da Academia.

- **Escopo inicial:** Região Metropolitana de São Paulo, 50 a 2.000 pessoas.
- **Expansão prevista:** Estado de SP, depois o Brasil.
- **Restrições:** custo zero (planos gratuitos), coleta mínima de dados (LGPD) e, se
  alguém invadir, quase nada de valor a levar.
- **Time:** voluntários, a maioria desenvolvendo com assistentes de IA.

> **Estado atual:** fundação (M0). A stack está decidida nos ADRs 0001 e 0009, e o app
> está só no esqueleto, ainda sem telas de negócio.

## Como rodar localmente

```bash
git clone https://github.com/felipemaion/Complexo42.git && cd Complexo42
nvm use            # Node 22 (arquivo .nvmrc)
npm run setup      # .env.local com chaves de TESTE, npm ci, Supabase local (Docker) e migrations
npm run dev        # http://localhost:3000
npm run check      # lint + tipos + testes + build, obrigatório antes do PR
npx playwright install chromium   # uma vez, para os testes E2E
npm run test:e2e   # Playwright: build de produção + testes de e2e/ (porta 3100)
```

Banco local: `npm run db:start`, `db:stop`, `db:reset` e `db:test` (ver [`CONTRIBUTING.md`](CONTRIBUTING.md)).

E2E com o banco (login pelo link mágico, perfil, casa, contato, meus dados, exclusão e o fluxo
completo do cadastro em `e2e/fluxo-completo.spec.ts`): com o Supabase local de pé e o app na
porta do `site_url` (3000), passe as chaves do `npx supabase status -o env` só para o teste,
como faz o job "E2E com banco" do CI:

```bash
eval "$(npx supabase status -o env)"
E2E_PORT=3000 E2E_LIVE_SUPABASE_URL=$API_URL E2E_LIVE_ANON_KEY=$ANON_KEY E2E_MAILPIT_URL=$MAILPIT_URL \
E2E_LIVE_SERVICE_KEY=$SERVICE_ROLE_KEY E2E_LIVE_SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY \
E2E_LIVE_DB_CONTAINER=supabase_db_complexo42 npm run test:e2e
```

## 👋 Chegou agora? Comece pelo [`docs/ONBOARDING.md`](docs/ONBOARDING.md)

Ele leva você do zero ao projeto rodando (Docker ou Codespaces) e ao primeiro PR.
Como a equipe trabalha: [`docs/GESTAO_EQUIPE.md`](docs/GESTAO_EQUIPE.md).

> O código é um **framework reutilizável** (ADR 0005): a Academia é a primeira instância.
> Outros usos (ex.: organizar times de voluntários de TI) serão deploys separados do mesmo código.

## Leia nesta ordem

| Documento | Para quê |
|---|---|
| [`AGENTS.md`](AGENTS.md) | **Regras obrigatórias** para quem programa, humano ou IA, e como escrever o código (§2.2) |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | Fluxo de branch, PR, testes e revisão |
| [`docs/PLANEJAMENTO.md`](docs/PLANEJAMENTO.md) | Visão, escopo, requisitos, arquitetura, riscos |
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | Milestones e tarefas |
| [`docs/MODELO_DADOS.md`](docs/MODELO_DADOS.md) | Entidades e lista fechada de campos permitidos |
| [`docs/DIAGRAMAS.md`](docs/DIAGRAMAS.md) | Unidades, papéis, quem vê o quê e fluxo do pedido (Mermaid) |
| [`docs/LGPD_E_SEGURANCA.md`](docs/LGPD_E_SEGURANCA.md) | Minimização de dados, ameaças e controles |
| [`docs/PERGUNTAS_STAKEHOLDER.md`](docs/PERGUNTAS_STAKEHOLDER.md) | Perguntas em aberto para a reunião |
| [`docs/adr/`](docs/adr/) | Decisões: 0001 stack · **0002 permissões por escopo** · **0003 criptografia dos dados** · ~~0004~~ · **0005 framework e hierarquia genérica** · **0006 missões, pontos e identidade das turmas** · **0007 equipes rotativas, medalhas e avaliação reservada** · **0008 lista de autorizados, casas e avaliação dupla** · **0009 hospedagem em servidor próprio** · **0010 quem vê o contato** · **0011 casa nacional e coordenador por território** · **0014 questionário das casas por eixos e totem** |
| [`SECURITY.md`](SECURITY.md) | Como reportar uma vulnerabilidade |

## Licença

[AGPL-3.0](LICENSE): quem modificar o código e oferecê-lo como serviço precisa publicar as
mudanças sob a mesma licença.

## Onde está cada coisa

- **Tarefas:** GitHub Issues (cada uma vinculada a um Milestone).
- **Decisões:** `docs/adr/NNNN-titulo.md`.
- **Código:** criado a partir da tarefa de scaffold do M0 (ainda não existe).
