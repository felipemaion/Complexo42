# Planejamento do POC

> Versão 0.2 (2026-11-28). Itens marcados **[?]**
> dependem de resposta em `PERGUNTAS_STAKEHOLDER.md`.

## 0. Contexto (atualizado em 2026-11-09)

- **Quem desenvolve:** alunos de TI da própria Academia, a maioria fazendo
  "vibe coding" com IA. O gestor do projeto atua como sênior e revisor (code owner).
- **Quem usa:** os **monitores** e **gestores** da Academia, para identificar habilidades,
  criar tarefas, acompanhar os **feitos** (tarefas concluídas e validadas) e dar **badges**.
  Os alunos se cadastram e executam as tarefas.
- **Futuro:** o mesmo código poderá servir a outros usos (ex.: organizar times de voluntários),
  cada um como **instância separada** (ADR 0005).
- **Reunião de kickoff (2026-11-09):** depois da Academia, os ex-alunos formam **equipes
  rotativas** que apoiam porta-vozes em formação, com medalhas, portfólio e avaliação
  reservada (ADR 0007). Os grupos de WhatsApp continuam; a plataforma direciona cada pessoa
  ao grupo certo.
- **Reunião de 2026-11-17 (ADR 0008):** o cadastro tem uma **lista de autorizados** (quem
  não está nela fica em espera); ao entrar, a pessoa escolhe ou é direcionada por
  questionário a uma **casa** de formação (quatro na instância piloto); a hierarquia é
  nacional → estado → região (incubadora) → casas e equipes; cada membro recebe avaliação da
  equipe e da casa. Usabilidade acima de aparência: botões grandes e nada escondido.
- **Decisão do gestor de 2026-11-24, aceita em 2026-11-27 (ADR 0013):** além do território e da casa, há o
  **núcleo**, agrupamento de debate e de tarefas públicas (reuniões, estudo, tarefas no bairro
  ou na cidade) com pessoas de regiões diferentes. Marco futuro, sem data.
- **Cronograma do stakeholder:**

  | Quando | O quê |
  |---|---|
  | até ~16/11 | Alinhamento: diagrama da estrutura organizacional e dos papéis |
  | até ~30/11 | Arquitetura da solução e plano de testes (inclui pentest) |
  | início de janeiro | Plataforma pronta (cadastro, habilidades, busca, equipes) |
  | fim de janeiro | Cadastro dos ex-alunos e direcionamento aos grupos |
  | março em diante | Atividades, missões e medalhas; montagem das equipes até ~julho |

  **Plano B** (do próprio stakeholder): se não ficar pronto, o cadastro de janeiro é feito
  num formulário. Por isso o cadastro e a busca por habilidade têm prioridade sobre missões
  e medalhas.
- **Segurança definida:** dados pessoais cifrados (ADR 0003) e acesso hierárquico por escopo
  (ADR 0002): monitor → turma/equipe; gestor estadual → UF; gestor nacional → tudo.

## 1. Visão

Dar à coordenação da Academia uma visão clara de **quem são os alunos, onde estão e o que
sabem fazer**, para montar **equipes (incubadoras)**, distribuir **ações** e reconhecer quem
executa com **medalhas virtuais**. Tudo isso com o mínimo de dados pessoais e custo zero.

## 2. Objetivos do piloto (proposta)

| Objetivo | Métrica sugerida [?] |
|---|---|
| Cadastrar os alunos da RMSP | ≥ 60% dos alunos ativos cadastrados em 30 dias |
| Formar incubadoras | ≥ 5 equipes formadas pela plataforma |
| Executar ações | ≥ 70% das ações atribuídas concluídas no prazo |
| Segurança | Zero incidentes; 100% das tabelas com teste de RLS |
| Custo | R$ 0/mês de infraestrutura no piloto |

## 3. Escopo

### Dentro do POC (MVP)
1. **Cadastro e perfil**: nome, WhatsApp, município/bairro, habilidades, links de redes
   sociais e "feitos". Consentimento LGPD, edição e exclusão da própria conta. Acesso só
   pela **lista de autorizados**, com lista de espera (ADR 0008 §1).
2. **Casa de formação** (ADR 0008 §2, ADR 0014): ordem de entrada termo → questionário →
   casa → perfil; sem casa a pessoa não vê nada. O questionário tem 26 perguntas (chave do
   Cortez, pesos 1-3-5, sem empate) e situa a pessoa em dois eixos (Ação×Contemplação e
   Leis×Costumes); o totem nunca aparece para ela, só no detalhe da coordenação. Casas:
   Esparta, Atenas, Alexandria e Siracusa. A sugestão não obriga: a escolha é livre, com a
   comparação 2×2 ("Compare as casas": média real dos membros com n ≥ 10 e expectativas por
   pergunta; respostas guardadas cifradas). Trava de 4 meses para trocar de casa, que a
   pessoa troca pela tela de comparação; a coordenação troca a qualquer momento.
3. **Painel da coordenação**: lista com filtros por habilidade e região, contagem por região.
4. **Equipes**: criar equipe, adicionar e remover membros, definir líder.
5. **Missões** (ADR 0006): catálogo de missões com etapas e pontos (ex.: escrever um projeto
   de lei = 10, protocolar = +30); a turma assume a missão, envia as entregas, o monitor
   valida, e os pontos vão para um livro-razão imutável. As turmas também podem **propor**
   missões para a sua região.
6. **Identidade e placar**: turma com nome, lema, cores e emblema; placar de turmas por
   escopo e período.
7. **Medalhas** (ADR 0006 §8 e ADR 0007 §3): manual, de evento, "trabalhou com" (do
   porta-voz), de marco, de presença, por missão ou por pontos; revogáveis.
8. **Equipes rotativas** (ADR 0007 §2): uma equipe por vez, com histórico.
9. **Portfólio por links** (ADR 0007 §5): até 3 itens, com prévia, sem guardar arquivos.
10. **Avaliação reservada** (ADR 0007 §4 e ADR 0008 §3): da equipe e da casa; desligada até
    o parecer jurídico.
11. **Núcleos** (ADR 0013, aceito, marco futuro): árvore de núcleos e subnúcleos fora do
    território, com cargos internos, entrada por pedido aprovado, reuniões com pauta, presença
    que conta pontos e missões assumidas pelo núcleo. Pendem só as perguntas 91 a 93, com padrão conservador.

### Fora do POC (por enquanto)
- Chat interno: o WhatsApp continua sendo o canal de conversa.
- Notificações por WhatsApp/SMS (pagas).
- Aplicativo nativo: o POC é web responsivo, que pode virar PWA.
- Upload de fotos, documentos e logos (fase 2; ver ADR 0006 §2 e §7).
- Ranking público **individual** (o placar é só entre turmas).
- Chat/salas internas (a discussão segue no WhatsApp da turma).
- Testes de personalidade e o módulo de formação de porta-vozes (ADR 0007 §6). O questionário
  das casas (ADR 0014) é outra coisa: situa a pessoa numa casa, não avalia personalidade.
- Importação de bases existentes: cada pessoa se cadastra do zero.
- Coordenação multi-estado (fica preparada no modelo, mas não é exposta na interface).

## 4. Personas e papéis (definidos — ADR 0002)

| Papel | Escopo | Pode |
|---|---|---|
| **Aluno** | si mesmo | Editar e excluir o próprio perfil; ver suas turmas, equipes, tarefas e badges; enviar a conclusão de tarefas |
| **Monitor** | turmas/equipes atribuídas | Ver os alunos do escopo e suas habilidades; criar tarefas; validar feitos; conceder badges |
| **Coordenador de núcleo** (ADR 0013, aceito) | o seu núcleo e os subnúcleos abaixo | Ver nome, habilidades e medalhas dos membros ativos; ver contato (auditado); aprovar pedidos de entrada só no próprio núcleo; remover pessoas dele e dos subnúcleos (auditado); registrar reuniões e presença. Sem escopo territorial |
| **Gestor estadual** | sua UF | Tudo do monitor na UF + criar turmas e equipes + nomear monitores |
| **Gestor nacional** | tudo | Tudo + catálogo de habilidades e badges + nomear gestores estaduais |
| **Admin técnico** | sistema | Configuração e primeiro gestor nacional. **Não vê dados pessoais** |

O líder de equipe é um papel dentro da equipe (`team_members.member_role`), sem acesso extra a
dados [?].

## 5. Requisitos funcionais (histórias)

**Cadastro (M1)**
- RF01: Como aluno, faço login por link no e-mail, Google ou senha opcional (ADR 0018), se o
  meu e-mail estiver na lista de autorizados (a coordenação usa "Autorizar um e-mail").
- RF02: Como aluno, aceito o termo de consentimento antes de preencher o perfil.
- RF03a: Como aluno, respondo o questionário e vejo a casa sugerida; comparo as casas e escolho
  (livre). Troco de casa só depois da trava de 4 meses.
- RF03: Como aluno, preencho nome, WhatsApp, município/bairro, habilidades, redes e feitos.
- RF04: Como aluno, edito meu perfil a qualquer momento.
- RF05: Como aluno, excluo minha conta e meus dados são apagados de fato.
- RF06: Como aluno, baixo meus dados (direito de acesso da LGPD).

**Coordenação (M2)**
- RF07: **Como gestor (principalmente o nacional), encontro pessoas por habilidade de forma
  fácil e rápida.** Exemplo: "quem sabe edição de vídeo e oratória em SP?". Combino várias
  habilidades (todas ou qualquer uma), nível, estado, região, município e turma. A busca
  sugere habilidades enquanto digito, inclusive por sinônimo ("designer" → Design). Vejo o
  resultado em segundos, com nome, turma, habilidades e pontos, e o contato só ao clicar
  (auditado). É um requisito prioritário (issue #23).
- RF08: Como coordenador, vejo um **mapa de calor** dos alunos por município/distrito (agregado,
  sem localização precisa; regiões com menos de 5 pessoas aparecem como "< 5").
- RF09: Como administrador, gerencio o catálogo de habilidades e os papéis.

**Equipes (M3)**
- RF10: Como coordenador, crio uma equipe e adiciono membros a partir dos filtros.
- RF11: Como coordenador, defino o líder da equipe.
- RF12: Como aluno, vejo minhas equipes e o contato dos colegas de equipe.

**Ações (M4)**
- RF13: Como coordenador ou líder [?], crio ações para uma equipe.
- RF14: Como membro, movo ações entre colunas.
- RF15: Como líder ou coordenador, aprovo a conclusão de uma ação.

**Medalhas (M5)**
- RF16: Como administrador, cadastro medalhas e suas regras.
- RF17: Como aluno, recebo a medalha ao cumprir a regra e a vejo no meu perfil.
- RF18: Como coordenador, concedo uma medalha manualmente, com justificativa.

## 6. Requisitos não funcionais

| Item | Requisito |
|---|---|
| Custo | **Custo zero (requisito).** Só planos gratuitos; alertar antes de atingir 80% de qualquer limite; nenhum serviço pago sem aprovação do gestor (AGENTS R19) |
| Escala | Até 2.000 usuários no piloto e 50.000 na expansão, sem reescrever |
| Dispositivo | Mobile-first; funcionar bem em Android de entrada e 4G |
| Acessibilidade | WCAG 2.1 AA nos fluxos de cadastro |
| Segurança | Ver `LGPD_E_SEGURANCA.md` |
| Qualidade | CI obrigatório; nada entra na `main` sem testes verdes e revisão |
| Disponibilidade | Melhor esforço; não é sistema crítico |

## 7. Arquitetura proposta

Detalhes e alternativas em `adr/0001-stack.md`; hospedagem em `adr/0009-hospedagem-servidor-proprio.md`.

```
Celular / navegador
   │  HTTPS
   ▼
Cloudflare → Caddy (complexo42.maionesys.com)
   ▼
Next.js (container no servidor próprio)
   - páginas (React)
   - Server Actions / Route Handlers  ← toda escrita passa por aqui, validada com Zod
   │  sessão do usuário (JWT); nunca service_role no cliente
   ▼
Supabase auto-hospedado mínimo (rede interna; só /auth/v1 é público)
   - Auth (Google / link por e-mail / senha opcional)
   - Postgres com RLS em TODAS as tabelas (negado por padrão)
   - Funções SQL para regras de medalha (security definer, testadas)
```

**Por que essa stack para voluntários com IA:** é a combinação que as IAs mais conhecem, tem
plano gratuito suficiente, e o Supabase permite rodar tudo localmente (`supabase start`) com
testes de banco. O maior risco dela, que é tabela sem RLS, é coberto por teste automático no CI.

## 8. Riscos

| Risco | Prob. | Impacto | Mitigação |
|---|---|---|---|
| Tabela sem RLS expõe dados (erro clássico de "vibe coding") | Alta | Alto | Teste no CI falha se alguma tabela não tiver RLS; teste de RLS obrigatório por tabela |
| Chave vazada no repositório | Média | Alto | gitleaks no CI; `.env*` no `.gitignore`; rotação documentada |
| Servidor único cai ou se perde | Baixa | Alto | Backup cifrado fora da VPS e migração ensaiada (ADR 0009 §4, §7) |
| Recursos do servidor (2 vCPU, 12 GB, compartilhados) estouram na expansão | Baixa (piloto) | Médio | Limites por serviço, teste de carga (#75) e monitoramento (#85) |
| Voluntários abandonam o projeto | Alta | Médio | Issues pequenas e autocontidas; documentação forte; dois mantenedores |
| Escopo cresce ("vira um Trello completo") | Alta | Médio | Lista "fora do POC" explícita; toda mudança de escopo passa pelo stakeholder |
| Cadastros falsos ou spam | Média | Baixo | Lista de autorizados (#26): só entra quem a coordenação autorizou |
| Dados de menores | Média | Alto | Bloquear menores de 18 no piloto [?] |

## 9. Equipe e cadência (sugestão)

- **Mantenedores (2):** revisam PRs com label `seguranca`, cuidam das chaves e fazem o deploy.
- **Voluntários:** pegam issues `pronta`.
- **Ritmo:** milestones de cerca de 2 semanas; uma chamada curta semanal; o estado das
  tarefas fica nas issues, não no grupo de WhatsApp.
